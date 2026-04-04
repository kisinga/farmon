// Barrel — importing triggers self-registration into registries.
import './tank';
import './pump';
import './endpoint';
import './valve';
import './flow-sensor';

export { NODE_REGISTRY, INLINE_REGISTRY } from '../entity-registry';
export type { NodeDescriptor, InlineComponentDescriptor, FieldDef } from '../entity-registry';
