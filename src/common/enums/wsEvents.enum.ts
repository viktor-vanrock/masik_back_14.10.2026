export enum WsEvent {
  // чат
  StartChat = 'start_chat',
  ChatStarted = 'chat_started',
  SendMessage = 'send_message',
  AgentMessage = 'agent_message',

  // поиск рекомендаций
  RequestRecommendations = 'request_recommendations',
  RecommendationRequestAccepted =
    'recommendation_request_accepted',
  RecommendationResult = 'recommendation_result',
  StartBenchmarkCreation = 'start_benchmark_creation',
  BenchmarkCreationStarted = 'benchmark_creation_started',

  // действия с полученными рекомендациями
  SelectRecommendation = 'select_recommendation',
  RejectRecommendation = 'reject_recommendation',
  RecommendationUpdated = 'recommendation_updated',

  // гипотезы
  RegenerateHypotheses = 'regenerate_hypotheses',
  HypothesesGenerated = 'hypotheses_generated',

  // ошибки
  Error = 'error'
}
