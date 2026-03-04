import Instance from "../../instances/Instance";
import Main from "../../Main";
import Relay from "../Relay";

export default abstract class RuntimeManager {
    constructor(protected readonly app: Main) { }
    abstract getName(): string;
    abstract isHost(relay: Relay): boolean | PromiseLike<boolean>;
    abstract checkHosts(): void | PromiseLike<void>;
    abstract create(relay: Relay): Promise<boolean>;
    abstract stop(relay: Relay): Promise<boolean>;
    abstract restart(relay: Relay): Promise<boolean>;
}

export interface AddressList {
    [proto: string]: string;
}