// Barrel — importing triggers self-registration into registries.
import './tank';
import './pump';
import './endpoint';
import './valve';
import './flow-sensor';

export { NODE_REGISTRY } from '../entity-registry';
export type { NodeDescriptor, FieldDef } from '../entity-registry';
