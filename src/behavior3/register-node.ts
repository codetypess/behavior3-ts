import { type NodeContructor } from "./context";
import { type Node, type NodeDef } from "./node";

type NodeEntry = {
    ctor: NodeContructor<Node>;
    descriptor: NodeDef;
};

const nodeClasses = new Map<string, NodeEntry>();

export function registerNode<T extends Node>(cls: NodeContructor<T>) {
    const descriptor = cls.descriptor;
    if (nodeClasses.has(descriptor.name)) {
        throw new Error(`node ${descriptor.name} already registered`);
    }
    if (descriptor.doc) {
        let doc = descriptor.doc.replace(/^[\r\n]+/, "");
        const leadingSpace = doc.match(/^ */)?.[0];
        if (leadingSpace) {
            doc = doc
                .substring(leadingSpace.length)
                .replace(new RegExp(`[\r\n]${leadingSpace}`, "g"), "\n")
                .replace(/ +$/, "");
        }
        descriptor.doc = doc;
    }
    nodeClasses.set(descriptor.name, {
        ctor: cls,
        descriptor: descriptor,
    });
}

export function getNodeDescriptors<GroupType extends string>() {
    return Array.from(nodeClasses.values()).map((v) => v.descriptor as NodeDef<GroupType>);
}

export function filterNodeDescriptors<GroupType extends string>(groupTypes: GroupType[]) {
    return Array.from(nodeClasses.values()).filter(
        ({ descriptor }) =>
            !descriptor.group?.length ||
            descriptor.group?.some((g) => groupTypes.indexOf(g as GroupType) >= 0)
    );
}
