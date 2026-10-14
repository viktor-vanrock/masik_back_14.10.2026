FROM registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24:24.13

WORKDIR /app

ENV NODE_ENV=production

COPY . .

CMD ["sh", "-c", "npm run prisma:migrate:deploy && npm run start:prod"]
