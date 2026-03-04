import { Presence as IPresence } from "@prisma/client";
import Main from "../Main";
import { JsonValue } from "@prisma/client/runtime/library";
import UserIdentifier from "../users/UserIdentifier";


export default class Presence implements IPresence {
    constructor(instance: IPresence, private readonly app: Main) {
        this.id = instance.id;
        this.user_id = instance.user_id;
        this.type = instance.type;
        this.data = instance.data;
        this.created_at = instance.created_at;
    }

    created_at: Date;
    id: number;
    user_id: number;
    type: string;
    data: JsonValue;

    get userIdentifier(): UserIdentifier {
        return UserIdentifier.fromString(this.user_id.toString());
    }

    get getUser() {
        return this.app.users.findUserById(this.user_id);
    }
}