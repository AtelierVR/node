import { Schema } from "ajv";
import { join } from "path";
import { cwd } from "process";
import Debug from "./Debug";

var RefParser = require('json-schema-ref-parser');

export default class Schemas {
    static get schemaPath() {
        return join(cwd(), 'schemas');
    }

    static async load(path: string): Promise<Schema | null> {
        let p = join(this.schemaPath, path + '.json');
        try {
            const parser = new RefParser();
            return await parser.dereference(p);
        } catch (error) {
            Debug.error("Error loading schema:", error);
            return null;
        }
    }
}