export interface IConversation {
    id: string;
    server: string;
    title: string | null;
    thumbnail: string | null;
    created_at: number;
    updated_at: number;
    last_message: number | null;
}

export interface IMessage {
    id: string;
    author: string;
    content: string;
    attachments: IMessageAttachment[];
    reply: string | null;
    created_at: number;
    edited_at: number | null;
}


// ============= CREATE CONVERSATION =============
export interface ICreateConversationInput {
    members: string[];
    title?: string;
    thumbnail?: string;
}


export interface ICreateConversationOutput extends IConversation {
    members: IConversationMember[];
    messages: IMessage[];
}

// ============= GET CONVERSATIONS =============
export interface IGetConversationsOutput {
    conversations: IGetConversationOutput[];
    limit: number;
    offset: number;
}

// ============= GET CONVERSATION =============
export interface IGetConversationOutput extends IConversation {
    members: IConversationMember[];
}

export interface IConversationMember {
    id: string;
    reference: string;
    last_read_at: number | null;
    joined_at: number;
}

// ============= SEND MESSAGE =============
export interface IMessageAttachment {
    type: string;
    url: string;
    size: number;
    mime: string;
    filename?: string;
}

export interface ISendMessageInput {
    content: string;
    attachments?: IMessageAttachment[];
    reply?: string;
}

export interface ISendMessageOutput extends IMessage {
    conversation_id: string;
}

// ============= GET MESSAGES =============
export interface IGetMessagesOutput {
    messages: IMessage[];
    limit: number;
    before?: number;
}

// ============= MARK AS READ =============
export interface IMarkAsReadInput { }

export interface IMarkAsReadOutput {
    success: boolean;
}

// ============= RECEIVE (Federated) =============
export type IOboxType = "create_message" | "edit_message" | "read" | "join" | "leave" | "typing" | "delete_message";

export interface IReceiveCreateMessageEvent {
    conversation_id: string;
    user: number;
    content: string;
    attachments: IMessageAttachment[];
    reply: string | null;
}
export interface IReceiveEditMessageEvent {
    id: string;
    conversation_id: string;
    user: number;
    content: string;
    edited_at: number;
}
export interface IReceiveReadEvent {
    conversation_id: string;
    user: number;
}

export interface IReceiveJoinConversationEvent {
    conversation_id: string;
    user: string; // i use a UserIdentifier here because a local user may add a remote user
    invited_by: number;
}

export interface IReceiveLeaveConversationEvent {
    conversation_id: string;
    user: string; // i use a UserIdentifier here because a local user may remove a remote user
    executed_by: number | null;
}

export interface IReceiveTypingEvent {
    conversation_id: string;
    user: number;
    is_typing: boolean;
}

export interface IReceiveDeleteMessageEvent {
    conversation_id: string;
    user: number;
    message_id: string;
}

export interface IReceiveInput {
    type: IOboxType;
    data: IReceiveCreateMessageEvent | IReceiveEditMessageEvent | IReceiveReadEvent | IReceiveJoinConversationEvent | IReceiveLeaveConversationEvent | IReceiveTypingEvent | IReceiveDeleteMessageEvent;
}

export interface IReceiveOutput {
    success: boolean;
}

// ============= INBOX (Federated - External to Internal) =============
export interface IInboxInput {
    type: IOboxType;
    data: IReceiveCreateMessageEvent | IReceiveEditMessageEvent | IReceiveReadEvent | IReceiveJoinConversationEvent | IReceiveLeaveConversationEvent | IReceiveTypingEvent | IReceiveDeleteMessageEvent;
}

export interface IInboxOutput {
    type: IOboxType;
    success: boolean;
}

export interface IInboxOutputMessage extends IInboxOutput {
    type: "create_message";
    data: IMessage | null;
}

export interface IInboxOutputRead extends IInboxOutput {
    type: "read";
    data: IMarkAsReadOutput | null;
}

export interface IInboxOutputEdit extends IInboxOutput {
    type: "edit_message";
    data: IMessage | null;
}

export interface IInboxOutputDeleteMessage extends IInboxOutput {
    type: "delete_message";
}

export interface IInboxOutputTyping extends IInboxOutput {
    type: "typing";
}

export interface IInboxOutputJoin extends IInboxOutput {
    type: "join";
    data: IConversationMember | null;
}

export interface IInboxOutputLeave extends IInboxOutput {
    type: "leave";
    data: IConversationMember | null;
}

// Input types for inbox
export interface IInboxInputMessage extends IInboxInput {
    type: "create_message";
    data: IReceiveCreateMessageEvent;
}

export interface IInboxInputEdit extends IInboxInput {
    type: "edit_message";
    data: IReceiveEditMessageEvent;
}

export interface IInboxInputRead extends IInboxInput {
    type: "read";
    data: IReceiveReadEvent;
}

export interface IInboxInputDeleteMessage extends IInboxInput {
    type: "delete_message";
    data: IReceiveDeleteMessageEvent;
}

export interface IInboxInputTyping extends IInboxInput {
    type: "typing";
    data: IReceiveTypingEvent;
}

export interface IInboxInputJoin extends IInboxInput {
    type: "join";
    data: IReceiveJoinConversationEvent;
}

export interface IInboxInputLeave extends IInboxInput {
    type: "leave";
    data: IReceiveLeaveConversationEvent;
}

// ============= OUTBOX (Federated - Internal to External) =============
export interface IOutboxInput {
    type: IOboxType;
    data: IReceiveCreateMessageEvent | IReceiveEditMessageEvent | IReceiveReadEvent | IReceiveJoinConversationEvent | IReceiveLeaveConversationEvent | IReceiveTypingEvent | IReceiveDeleteMessageEvent;
}

export interface IOutboxOutput {
    type: IOboxType;
    success: boolean;
}

export interface IOutboxOutputMessage extends IOutboxOutput {
    type: "create_message";
    data: ISendMessageOutput | null;
}

export interface IOutboxInputMessage extends IOutboxInput {
    type: "create_message";
    data: IReceiveCreateMessageEvent;
}

export interface IOutboxOutputRead extends IOutboxOutput {
    type: "read";
}

export interface IOutboxInputRead extends IOutboxInput {
    type: "read";
    data: IReceiveReadEvent;
}

export interface IOutboxOutputEdit extends IOutboxOutput {
    type: "edit_message";
    data: ISendMessageOutput | null;
}

export interface IOutboxInputEdit extends IOutboxInput {
    type: "edit_message";
    data: IReceiveEditMessageEvent;
}

export interface IOutboxOutputDeleteMessage extends IOutboxOutput {
    type: "delete_message";
}

export interface IOutboxInputDeleteMessage extends IOutboxInput {
    type: "delete_message";
    data: IReceiveDeleteMessageEvent;
}

export interface IOutboxOutputTyping extends IOutboxOutput {
    type: "typing";
}

export interface IOutboxInputTyping extends IOutboxInput {
    type: "typing";
    data: IReceiveTypingEvent;
}

export interface IOutboxOutputJoin extends IOutboxOutput {
    type: "join";
    data: IConversationMember | null;
}

export interface IOutboxInputJoin extends IOutboxInput {
    type: "join";
    data: IReceiveJoinConversationEvent;
}

export interface IOutboxOutputLeave extends IOutboxOutput {
    type: "leave";
    data: IConversationMember | null;
}

export interface IOutboxInputLeave extends IOutboxInput {
    type: "leave";
    data: IReceiveLeaveConversationEvent;
}

// ============= RECEIVE CONVERSATION REFERENCE (Federated) =============
export interface IReceiveConversationReferenceInput {
    id: string;
    users: number[];
}

export interface IReceiveConversationReferenceOutput {
    success: boolean;
}

// ============= LOCAL NOTIFICATION EVENTS =============
export interface ILocalNotificationCreateEvent {
    conversation_id: string;
    message: IMessage;
}

export interface ILocalNotificationEditEvent {
    conversation_id: string;
    message_id: string;
    user: string | number;
    content: string;
    edited_at: number;
}

export interface ILocalNotificationReadEvent {
    conversation_id: string;
    user: string;
}

export interface ILocalNotificationDeleteMessageEvent {
    conversation_id: string;
    user: string;
    message_id: string;
}

export interface ILocalNotificationTypingEvent {
    conversation_id: string;
    user: string | number;
    is_typing: boolean;
}

export interface ILocalNotificationJoinEvent {
    conversation_id: string;
    user: string;
    invited_by: string | number;
}

export interface ILocalNotificationLeaveEvent {
    conversation_id: string;
    user: string;
    executed_by: string | number | null;
}

export type LocalNotificationEventType =
    | 'create'
    | 'edit'
    | 'read'
    | 'delete_message'
    | 'typing'
    | 'join'
    | 'leave';

export interface ILocalNotificationEvent {
    type: LocalNotificationEventType;
    data:
        | ILocalNotificationCreateEvent
        | ILocalNotificationEditEvent
        | ILocalNotificationReadEvent
        | ILocalNotificationDeleteMessageEvent
        | ILocalNotificationTypingEvent
        | ILocalNotificationJoinEvent
        | ILocalNotificationLeaveEvent;
}

export interface ILocalNotificationEventCreate extends ILocalNotificationEvent {
    type: 'create';
    data: ILocalNotificationCreateEvent;
}

export interface ILocalNotificationEventEdit extends ILocalNotificationEvent {
    type: 'edit';
    data: ILocalNotificationEditEvent;
}

export interface ILocalNotificationEventRead extends ILocalNotificationEvent {
    type: 'read';
    data: ILocalNotificationReadEvent;
}

export interface ILocalNotificationEventDeleteMessage extends ILocalNotificationEvent {
    type: 'delete_message';
    data: ILocalNotificationDeleteMessageEvent;
}

export interface ILocalNotificationEventTyping extends ILocalNotificationEvent {
    type: 'typing';
    data: ILocalNotificationTypingEvent;
}

export interface ILocalNotificationEventJoin extends ILocalNotificationEvent {
    type: 'join';
    data: ILocalNotificationJoinEvent;
}

export interface ILocalNotificationEventLeave extends ILocalNotificationEvent {
    type: 'leave';
    data: ILocalNotificationLeaveEvent;
}