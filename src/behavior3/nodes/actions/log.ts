import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { type Tree } from "../../tree";

enum LogLevel {
    LOG = "log",
    DEBUG = "debug",
    WARN = "warn",
    ERROR = "error",
}

export class Log extends Node {
    declare input: [unknown?];
    declare args: {
        readonly message: string;
        readonly level: LogLevel;
    };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [inputMsg] = this.input;
        const args = this.args;
        const level = args.level ?? LogLevel.LOG;
        let print = console.log;
        let prefix: string = "";
        if (level === LogLevel.LOG) {
            print = console.log;
            prefix = "behavior3 -> log:";
        } else if (level === LogLevel.DEBUG) {
            print = console.debug;
            prefix = "behavior3 -> debug:";
        } else if (level === LogLevel.WARN) {
            print = console.warn;
            prefix = "behavior3 -> warn:";
        } else if (level === LogLevel.ERROR) {
            print = console.error;
            prefix = "behavior3 -> error:";
        }
        print.call(console, prefix, args.message, inputMsg ?? "");
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Log",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "打印日志",
            input: ["日志?"],
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "日志",
                },
                {
                    name: "level",
                    type: "string",
                    desc: "日志级别",
                    default: LogLevel.LOG,
                    options: [
                        { name: "LOG", value: LogLevel.LOG },
                        { name: "DEBUG", value: LogLevel.DEBUG },
                        { name: "WARN", value: LogLevel.WARN },
                        { name: "ERROR", value: LogLevel.ERROR },
                    ],
                },
            ],
        };
    }
}
