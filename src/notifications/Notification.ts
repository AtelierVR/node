import Main from "../Main";
import { $Enums, Notification as INotification } from "@prisma/client";
import UserIdentifier from "../users/UserIdentifier";
import { JsonValue } from "@prisma/client/runtime/library";

export default class Notification implements INotification {
    constructor(data: INotification, private readonly main: Main) {
        this.id = data.id;
        this.external_id = data.external_id;
        this.type = data.type;
        this.to_user_id = data.to_user_id;
        this.data = data.data;
        this.expires_at = data.expires_at;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    data: JsonValue;
    id: number;
    external_id: string | null;
    type: string;
    to_user_id: number;
    expires_at: Date | null;

    isExpired(): boolean {
        if (!this.expires_at) return false;
        return this.expires_at < new Date();
    }

    toToUserIdentifier() {
        return new UserIdentifier(this.to_user_id);
    }

    getToUser() {
        return this.main.users.findUserById(this.to_user_id);
    }
}
