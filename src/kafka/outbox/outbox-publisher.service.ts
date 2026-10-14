import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaEnvType } from '@/configs/types';
import { OutboxMessage } from '@/generated/prisma/client';
import { ProducerService } from '../producer.service';
import { IOutboxRepository } from './outbox.repository.interface';

const OUTBOX_BATCH_SIZE = 50;
const OUTBOX_POLL_INTERVAL_MS = 1_000;

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;

const MAX_STORED_ERROR_LENGTH = 2_000;

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);

  /**
   * Флаг останавливает создание новых циклов во время shutdown.
   */
  private stopped = false;

  /**
   * Ссылка на запланированный setTimeout нужна,
   * чтобы отменить его при завершении приложения.
   */
  private timer: NodeJS.Timeout | undefined;

  /**
   * Здесь хранится уже выполняющаяся итерация.
   * Перед shutdown мы дождёмся её завершения.
   */
  private activeRun: Promise<void> | undefined;
  private readonly enabled: boolean;

  constructor(
    @Inject(IOutboxRepository)
    private readonly outboxRepository: IOutboxRepository,
    private readonly producer: ProducerService,
    configService: ConfigService
  ) {
    this.enabled = configService.getOrThrow<KafkaEnvType>('kafka').enabled;
  }

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Outbox publisher is disabled');
      return;
    }

    this.stopped = false;

    this.scheduleNext(0);

    this.logger.log('Outbox publisher started');
  }

  async beforeApplicationShutdown(): Promise<void> {
    /**
     * BeforeApplicationShutdown вызывается раньше отключения Kafka producer.
     * Поэтому текущая отправка успеет завершиться до producer.disconnect().
     */
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Если прямо сейчас отправляется пачка, корректно дожидаемся её.
    await this.activeRun;

    this.logger.log('Outbox publisher stopped');
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    /**
     * Рекурсивный setTimeout выбран вместо setInterval:
     * следующая итерация начнётся только после завершения предыдущей.
     *
     * Так две пачки не смогут выполняться одновременно
     * внутри одного экземпляра приложения.
     */
    this.timer = setTimeout(() => {
      this.activeRun = this.publishBatch()
        .catch((error: unknown) => {
          /**
           * Сюда попадут общие ошибки, например недоступность PostgreSQL
           * во время поиска очередной пачки.
           */
          this.logger.error(
            `Outbox batch failed: ${this.getErrorMessage(error)}`
          );
        })
        .finally(() => {
          this.activeRun = undefined;
          this.scheduleNext(OUTBOX_POLL_INTERVAL_MS);
        });
    }, delayMs);

    /**
     * Сам таймер не должен удерживать Node.js-процесс при завершении.
     * HTTP-сервер Nest всё равно продолжает удерживать процесс в работе.
     */
    this.timer.unref();
  }

  private async publishBatch(): Promise<void> {
    const messages = await this.outboxRepository.findPending({
      availableBefore: new Date(),
      limit: OUTBOX_BATCH_SIZE,
    });

    /**
     * Пока отправляем последовательно.
     *
     * Это проще для контроля нагрузки и сохраняет понятный порядок.
     * Параллельную обработку можно добавить после измерения нагрузки.
     */
    for (const message of messages) {
      if (this.stopped) {
        return;
      }

      await this.publishMessage(message);
    }
  }

  private async publishMessage(message: OutboxMessage): Promise<void> {
    if (!message.claimToken) {
      this.logger.warn(
        `Skipped Outbox message without a publish lease: eventId="${message.id}"`
      );
      return;
    }
    try {
      const value = JSON.stringify(message.payload);

      if (undefined === value) {
        throw new Error('Outbox payload cannot be serialized to JSON');
      }

      await this.producer.produce({
        topic: message.topic,

        /**
         * -1 означает ожидание подтверждения от всех доступных ISR-реплик.
         *
         * Локально у нас одна реплика.
         * В production надёжность также будет зависеть от replication factor
         * и min.insync.replicas самого Kafka-кластера.
         */
        acks: -1,

        messages: [
          {
            /**
             * Одинаковый requestId попадёт в одну Kafka partition.
             * Это важно для порядка событий одного бизнес-запроса.
             */
            key: message.messageKey,
            value,

            /**
             * Payload остаётся главным контрактом.
             * Headers помогают диагностике без десериализации value.
             */
            headers: {
              'content-type': 'application/json',
              'event-id': message.id,
              'event-type': message.eventType,
            },
          },
        ],
      });

      /**
       * publishedAt ставим только после успешного Kafka acknowledgement.
       */
      const markedAsPublished = await this.outboxRepository.markPublished({
        id: message.id,
        claimToken: message.claimToken,
        publishedAt: new Date(),
      });

      if(!markedAsPublished) {
        this.logger.warn(
          `Outbox message was already handled: eventId="${message.id}"`
        );

        return;
      }

      this.logger.log(
        `Outbox message published: eventId="${message.id}", ` +
        `topic="${message.topic}"`
      );
    } catch (error: unknown) {
      const errorMessage = this.getErrorMessage(error);
      const retryDelayMs = this.calculateRetryDelay(message.attempts);
      const availableAt = new Date(Date.now() + retryDelayMs);

      /**
       * Kafka-сообщение могло быть принято брокером непосредственно
       * перед падением приложения или ошибкой обновления PostgreSQL.
       *
       * Поэтому при retry возможен дубль с тем же eventId.
       */
      const markedAsFailed = await this.outboxRepository.markFailed({
        id: message.id,
        claimToken: message.claimToken,
        availableAt,
        lastError: errorMessage,
      });

      if (!markedAsFailed) {
        this.logger.warn(
          'Failed outbox message was already handled: ' +
          `eventId="${message.id}"`
        );

        return;
      }

      this.logger.warn(
        `Outbox publish failed: eventId="${message.id}", ` +
        `retryInMs=${retryDelayMs}, error="${errorMessage}"`
      );
    }
  }

  private calculateRetryDelay(attempts: number): number {
    /**
     * Exponential backoff:
     *
     * первая ошибка: 1 секунда;
     * вторая:        2 секунды;
     * третья:        4 секунды;
     * затем 8, 16, 32 и максимум 60 секунд.
     *
     * Ограничение exponent защищает вычисление от огромных чисел.
     */
    const exponent = Math.min(attempts, 10);
    const exponentialDelay =
      RETRY_BASE_DELAY_MS * 2 ** exponent;

    return Math.min(exponentialDelay, RETRY_MAX_DELAY_MS);
  }

  private getErrorMessage(error: unknown): string {
    /**
     * Не сохраняем stack trace и payload:
     * они могут быть огромными или содержать чувствительные данные.
     */
    const message =
      error instanceof Error ? error.message : String(error);

    return message.slice(0, MAX_STORED_ERROR_LENGTH);
  }
}
