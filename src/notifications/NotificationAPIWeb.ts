import Main from "../Main";
import NotificationManager from "./NotificationManager";
import Express from "express";
import NetExpress, { Request, Response } from "../network/NetExpress";
import NetServer from "../server/NetServer";
import { ErrorMessage, normalizeText } from "../utils/Utils";
import { ErrorCodes } from "../utils/Constants";
import UserManager from "../users/UserManager";
import User from "../users/User";

export default class NotificationAPIWeb {
    constructor(private readonly app: Main, private readonly notificationManager: NotificationManager) {
        this.app.http.express.server.post("/api/notifications", Express.json(), NetExpress.validate('notifications/create'), (req, res) => this.handleMakeNotification(req as Request<{}>, res as Response));
        this.app.http.express.server.get("/api/users/@me/notifications", (req, res) => this.handleGetNotifications(req as Request<{}>, res as Response));
    }

    async handleMakeNotification(request: Request<{}>, response: Response) {
        if (!request.data.isChallenge())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const server = await request.data.getData() as NetServer | null;
        if (!server)
            return response.send(new ErrorMessage(ErrorCodes.ServerNotFound));
        const data = request.body;
        if (!checkMakeNotificationData(data))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "data", "INotification"));
        data.type = normalizeText(data.type);
        let to_users: User[] = await this.app.users.findUsersByIds(data.to);
        if (!to_users.every(user => data.to.includes(user.id)))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "to", "id[]"));
        let result = await this.notificationManager.makeNotification({
            type: data.type,
            to: to_users,
            data: data.data,
            external_id: data.external_id,
            expires_at: data.expires_at ? new Date(data.expires_at) : undefined
        });
        if (!result)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "make notification"));
        let address = this.app.server.getInfos().address;
        let response_data: IMakeNotificationResponse = {
            type: data.type,
            to: result.map(notification => notification.toToUserIdentifier().toString(address)),
            data: data.data,
            external_id: data.external_id,
            expires_at: data.expires_at
        }
        return response.send(response_data);
    }

    async handleGetNotifications(request: Request<{}>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));
        let { after, limit, offset } = request.query;
        if (!after || typeof after !== "string")
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "after", "timestamp"));
        if (!limit || typeof limit !== "string") limit = "50";
        if (!offset || typeof offset !== "string") offset = "0";
        if (!/^\d+$/.test(limit))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "limit", "number"));
        if (!/^\d+$/.test(offset))
            return response.send(new ErrorMessage(ErrorCodes.InvalidField, "offset", "number"));
        let ilimit = parseInt(limit);
        let ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;
        let iafter = new Date(parseInt(after));
        let { notifications, total } = await this.notificationManager.getNotifications(user, iafter, ilimit, ioffset);
        let response_data: IGetNotificationsResponse = {
            total,
            after: iafter.getTime(),
            limit: ilimit,
            offset: ioffset,
            notifications: notifications.map(notification => ({
                type: notification.type,
                data: notification.data,
                external_id: notification.external_id || undefined,
                expires_at: notification.expires_at?.getTime(),
                created_at: notification.created_at.getTime(),
            }))
        };
        response.send(response_data);
    }
}

export interface INotificationResponse {
    type: string;
    data: any;
    external_id?: string;
    expires_at?: number;
    created_at: number;
}

export interface IGetNotificationsResponse {
    total: number;
    after: number;
    limit: number;
    offset: number;
    notifications: INotificationResponse[];
}

export interface IMakeNotificationResponse {
    type: string;
    to: string[];
    data: any;
    external_id?: string;
    expires_at?: number;
}

// Regex pour valider un UUID v4
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUIDv4(uuid: string): boolean {
    return UUID_V4_REGEX.test(uuid);
}

function checkMakeNotificationData(data: any): data is IMakeNotification {
    return typeof data === "object"
        && typeof data.type === "string"
        && Array.isArray(data.to) && data.to.every((v: any) => typeof v === "number" && UserManager.isValidId(v))
        && typeof data.data !== "undefined"
        && (data.external_id === undefined || (typeof data.external_id === "string" && isValidUUIDv4(data.external_id)))
        && ((
            typeof data.expires_at === "number"
            && data.expires_at > Date.now()
        ) || data.expires_at === undefined);
}


export interface IMakeNotification {
    type: string; // type of notification
    to: number[]; // id of the users who will receive the notification
    data: any; // data of the notification
    external_id?: string; // identifiant UUID v4 donné par l'envoyeur
    expires_at?: number; // timestamp d'expiration (optionnel)
}