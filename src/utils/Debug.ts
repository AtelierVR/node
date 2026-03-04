import { EventEmitter } from 'events';

export interface LogEntry {
    timestamp: Date;
    level: 'log' | 'error' | 'warning' | 'debug';
    message: string;
}

export default class Debug {
    private static logs: LogEntry[] = [];
    private static maxLogs = 1000; // Keep last 1000 log entries
    private static emitter = new EventEmitter();

    /**
     * Subscribe to log events
     * @param listener - Function called when a new log is added
     * @returns Unsubscribe function
     */
    static onLog(listener: (log: LogEntry) => void): () => void {
        this.emitter.on('log', listener);
        return () => this.emitter.off('log', listener);
    }

    private static addLog(level: LogEntry['level'], ...args: any[]) {
        const timestamp = new Date();
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        const logEntry = { timestamp, level, message };
        this.logs.push(logEntry);

        // Keep only the last maxLogs entries
        if (this.logs.length > this.maxLogs) 
            this.logs = this.logs.slice(-this.maxLogs);

        // Emit event for listeners
        this.emitter.emit('log', logEntry);
    }

    static getLogs(limit?: number, after?: number): LogEntry[] {
        let filteredLogs = this.logs;
        
        // Filter by timestamp if 'after' is provided
        if (after !== undefined) {
            filteredLogs = this.logs.filter(log => log.timestamp.getTime() > after);
        }
        
        return limit
            ? filteredLogs.slice(-limit)
            : [...filteredLogs];
    }

    static clearLogs() {
        this.logs = [];
    }

    static log(...args: any[]) {
        console.log(new Date().toISOString(), '|', ...args);
        this.addLog('log', ...args);
    }

    static error(...args: any[]) {
        console.error(new Date().toISOString(), '|', ...args);
        this.addLog('error', ...args);
    }

    static warn(...args: any[]) {
        console.warn(new Date().toISOString(), '|', ...args);
        this.addLog('warning', ...args);
    }

    static debug(...args: any[]) {
        console.debug(new Date().toISOString(), '|', ...args);
        this.addLog('debug', ...args);
    }

    static dir(obj: any, options?: { depth?: number | null; colors?: boolean }) {
        console.dir(obj, {
            depth: options?.depth ?? 2,
            colors: options?.colors ?? true
        });
    }
}