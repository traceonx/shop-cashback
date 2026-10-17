export interface IncomingMessage {
  channel: string
  channelInstanceId: string
  externalUserId: string
  messageId: string
  messageType: string
  content: string
  timestamp: number
}
export interface ChannelAdapter {
  channel: string
  sendText(externalUserId: string, content: string): Promise<void>
  getStatus(): Promise<{ connected: boolean; lastError?: string }>
}
/** Only a verified callback may create this internal identity. Never accept it from browser input. */
export interface VerifiedIdentity {
  internalUserId: string
  channelInstanceId: string
  externalUserId: string
}
