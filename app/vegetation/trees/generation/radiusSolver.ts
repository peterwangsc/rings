import type { TreeSkeleton, TreeSystemConfig } from "../types";

function collectReachableNodeIds(skeleton: TreeSkeleton) {
  const reachable = new Set<number>();
  const stack = [skeleton.rootId];

  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined || reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    for (const childId of skeleton.nodes[nodeId].children) {
      stack.push(childId);
    }
  }

  return reachable;
}

export function solveBranchRadii(
  skeleton: TreeSkeleton,
  config: TreeSystemConfig,
  trunkPreserveDepth: number,
) {
  const reachable = collectReachableNodeIds(skeleton);
  const postOrder: number[] = [];
  const stack: Array<{ nodeId: number; visited: boolean }> = [
    { nodeId: skeleton.rootId, visited: false },
  ];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }

    if (item.visited) {
      postOrder.push(item.nodeId);
      continue;
    }

    stack.push({ nodeId: item.nodeId, visited: true });
    const children = skeleton.nodes[item.nodeId].children;
    for (let i = children.length - 1; i >= 0; i--) {
      const childId = children[i];
      if (reachable.has(childId)) {
        stack.push({ nodeId: childId, visited: false });
      }
    }
  }

  const gamma = config.radius.gamma;
  const twigRadius = config.radius.twigRadius;

  for (let i = postOrder.length - 1; i >= 0; i--) {
    const node = skeleton.nodes[postOrder[i]];
    if (node.children.length === 0) {
      node.radius = twigRadius;
      continue;
    }

    let sum = 0;
    for (const childId of node.children) {
      const childRadius = skeleton.nodes[childId].radius;
      sum += childRadius ** gamma;
    }

    node.radius = sum > 0 ? sum ** (1 / gamma) : twigRadius;
  }

  const minKeptRadius = config.radius.minKeptRadius;
  const pruneStack = [skeleton.rootId];

  while (pruneStack.length > 0) {
    const nodeId = pruneStack.pop();
    if (nodeId === undefined) {
      continue;
    }

    const node = skeleton.nodes[nodeId];
    node.children = node.children.filter((childId) => {
      const child = skeleton.nodes[childId];
      const shouldKeep =
        child.depth <= trunkPreserveDepth ||
        child.radius >= minKeptRadius ||
        child.children.length > 0;
      return shouldKeep;
    });

    for (const childId of node.children) {
      pruneStack.push(childId);
    }
  }

  const newReachable = collectReachableNodeIds(skeleton);
  skeleton.terminalNodeIds = [];
  for (const nodeId of newReachable) {
    if (skeleton.nodes[nodeId].children.length === 0) {
      skeleton.terminalNodeIds.push(nodeId);
    }
  }

  return skeleton;
}
