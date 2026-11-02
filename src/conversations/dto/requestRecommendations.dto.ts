import { IsString, IsUUID, MinLength } from 'class-validator';

export class RequestRecommendationsDto {
  /**
   * Conversation остаётся контейнером пользовательского workflow:
   * через него мы свяжем запрос, результат и WebSocket-клиента.
   */
  @IsUUID('4')
  conversationId!: string;

  /**
   * Это уже готовое описание пожеланий пользователя.
   * Embeddings и остальные ML-данные браузер не передаёт.
   */
  @IsString()
  @MinLength(1)
  query!: string;
}
