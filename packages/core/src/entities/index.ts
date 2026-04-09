// Barrel — importing triggers self-registration into registries.
import './tank';
import './pump';
import './endpoint';
import './valve';
import './flow-sensor';
import './water-source';
import './pressure-sensor';
import './filter';
import './dosing-pump';

export { NODE_REGISTRY, legendSvgFor } from '../entity-registry';
export type { NodeDescriptor, FieldDef } from '../entity-registry';
