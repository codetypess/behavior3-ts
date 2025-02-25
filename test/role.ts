import * as fs from "node:fs";
import { Context, Node, NodeDef, TreeData } from "../src/behavior3";
import { DeepReadonly } from "../src/behavior3/context";
import { Attack } from "./nodes/attack";
import { FindEnemy } from "./nodes/find-enemy";
import { GetHp } from "./nodes/get-hp";
import { Idle } from "./nodes/idle";
import { IsStatus } from "./nodes/is-status";
import { MoveToPos } from "./nodes/move-to-pos";
import { MoveToTarget } from "./nodes/move-to-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// deno-lint-ignore no-explicit-any
export type Callback = (...args: any[]) => void;

export interface Role {
    hp: number;
    x: number;
    y: number;
}

export interface Position {
    x: number;
    y: number;
}

export class RoleContext extends Context {
    avators: Role[] = [];

    constructor() {
        super();
        this.registerNode(Attack);
        this.registerNode(FindEnemy);
        this.registerNode(GetHp);
        this.registerNode(Idle);
        this.registerNode(IsStatus);
        this.registerNode(MoveToPos);
        this.registerNode(MoveToTarget);

        // 用于加速执行表达式，此代码可以通过脚本扫描所有行为树，预先生成代码，然后注册到 Context 中
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // deno-lint-ignore no-explicit-any
        this.registerCode("hp > 50", (envars: any) => {
            return envars.hp > 50;
        });
    }

    override loadTree(path: string): Promise<Node> {
        const treeData = JSON.parse(fs.readFileSync(path, "utf-8")) as TreeData;
        const rootNode = this._createTree(treeData);
        this.trees[path] = rootNode;
        return Promise.resolve(rootNode);
    }

    override get time() {
        return this._time;
    }

    override set time(value: number) {
        this._time = value;
    }

    find(func: Callback, _count: number) {
        return this.avators.filter((value) => func(value));
    }

    exportNodeDefs() {
        const defs: DeepReadonly<NodeDef>[] = [];
        Object.values(this.nodeDefs).forEach((descriptor) => {
            defs.push(descriptor);
            if (descriptor.name === "Listen") {
                (descriptor as NodeDef).args?.[0].options?.push(
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
        });
        defs.sort((a, b) => a.name.localeCompare(b.name));
        let str = JSON.stringify(defs, null, 2);
        str = str.replace(/"doc": "\\n +/g, '"doc": "');
        str = str.replace(/\\n +/g, "\\n");
        return str;
    }
}
