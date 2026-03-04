import { $Enums, UserRelation as IUserRelation } from "@prisma/client";
import Main from "../Main";
import UserIdentifier from "../users/UserIdentifier";
import User from "../users/User";
import NetUser from "../users/NetUser";

export default class UserRelation implements IUserRelation {
    constructor(user: IUserRelation, private readonly app: Main) {
        this.id = user.id;
        this.type = user.type;
        this.initiator_ref = user.initiator_ref;
        this.target_ref = user.target_ref;
        this.created_at = user.created_at;
        this.updated_at = user.updated_at;
    }

    created_at: Date;
    updated_at: Date;
    id: string;
    type: $Enums.UserRelationType;
    initiator_ref: string;
    target_ref: string;

    private async getUser(id: UserIdentifier): Promise<User | NetUser | null> {
        if (id.isUsername())
            return await this.app.users.findUserByUsername(id.identifierAsUsername());
        if (id.isLocal())
            return await this.app.users.findUserById(id.identifierAsId());
        const server = await this.app.netServers.findNetServerByAddress(id.server as string);
        if (!server) return null;
        return await this.app.netUsers.findNetUserById(id.identifier as number, server.id);
    }

    async getTarget(): Promise<User | NetUser | null> {
        return await this.getUser(this.targetRef);
    }

    get targetRef(): UserIdentifier {
        return UserIdentifier.fromString(this.target_ref);
    }

    async getInitiator(): Promise<User | NetUser | null> {
        return await this.getUser(this.initiatorRef);
    }

    get initiatorRef(): UserIdentifier {
        return UserIdentifier.fromString(this.initiator_ref);
    }

    delete(): Promise<boolean> {
        return this.app.relations.deleteRelation(this.id);
    }

    update(): Promise<boolean> {
        return this.app.relations.updateRelation(this);
    }
}