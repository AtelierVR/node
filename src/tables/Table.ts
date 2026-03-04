import { Table as ITable } from "@prisma/client";
import Main from "../Main";
import User from "../users/User";

export default class Table implements ITable {
    constructor(table: ITable, private readonly app: Main) {
        this.id = table.id;
        this.key = table.key;
        this.user_id = table.user_id;
        this.value = table.value;
        this.created_at = table.created_at;
        this.updated_at = table.updated_at;
        this.mime = table.mime;
    }

    mime: string;
    id: number;
    key: string;
    user_id: number;
    value: Uint8Array<ArrayBufferLike>;
    created_at: Date;
    updated_at: Date;

    async getUser(): Promise<User> {
        var user = await this.app.users.findUserById(this.user_id);
        if (!user) throw new Error("User not found for table entry");
        return user;
    }

    /**
     * Update this table entry in the database
     */
    async update(newValue: Buffer): Promise<Table | null> {
        try {
            const updatedTable = await this.app.database.table.update({
                where: { id: this.id },
                data: { value: newValue }
            });
            this.value = updatedTable.value;
            this.updated_at = updatedTable.updated_at;
            return this;
        } catch (error) {
            return null;
        }
    }

    /**
     * Delete this table entry from the database
     */
    async delete(): Promise<boolean> {
        try {
            await this.app.database.table.delete({
                where: { id: this.id }
            });
            return true;
        } catch (error) {
            return false;
        }
    }
}
