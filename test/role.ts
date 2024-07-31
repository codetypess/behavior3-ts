import { Context, NodeDef, TreeEnv, TreeRunner } from "../src/behavior3";
import { Attack } from "./nodes/attack";
import { FindEnemy } from "./nodes/find-enemy";
import { GetHp } from "./nodes/get-hp";
import { Idle } from "./nodes/idle";
import { IsStatus } from "./nodes/is-status";
import { MoveToPos } from "./nodes/move-to-pos";
import { MoveToTarget } from "./nodes/move-to-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Callback = (...args: any[]) => void;

export interface Role {
    hp: number;
    x: number;
    y: number;
    tree: TreeRunner<RoleTreeEnv>;
}

export interface Position {
    x: number;
    y: number;
}

export class RoleTreeEnv extends TreeEnv<RoleContext> {
    owner!: Role;
}

export class RoleContext extends Context {
    avators: Role[] = [];

    constructor() {
        super();
        this.registerProcess(Attack);
        this.registerProcess(FindEnemy);
        this.registerProcess(GetHp);
        this.registerProcess(Idle);
        this.registerProcess(IsStatus);
        this.registerProcess(MoveToPos);
        this.registerProcess(MoveToTarget);

        // 用于加速执行表达式，此代码可以通过脚本扫描所有行为树，预先生成代码，然后注册到 Context 中
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.registerCode("hp > 50", (envars: any) => {
            return envars.hp > 50;
        });
    }

    override get time() {
        return this._time;
    }

    override set time(value: number) {
        this._time = value;
    }

    find(func: Callback, count: number) {
        return this.avators.filter((value) => func(value));
    }

    exportNodeDefs() {
        const defs: NodeDef[] = [];
        for (const v of this._processResolvers.values()) {
            const descriptor = v.descriptor;
            defs.push(descriptor);
            if (descriptor.name === "Listen") {
                descriptor.args?.[0].options?.push(
                    ...[
                        {
                            name: "testOff",
                            value: "testOff",
                        },
                        {
                            name: "hello",
                            value: "hello",
                        },
                    ]
                );
            }
        }
        defs.sort((a, b) => a.name.localeCompare(b.name));
        let str = JSON.stringify(defs, null, 2);
        str = str.replace(/"doc": "\\n +/g, '"doc": "');
        str = str.replace(/\\n +/g, "\\n");
        return str;
    }
}
