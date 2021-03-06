import { DEBUG } from '@glimmer/env';
import { ComponentCapabilities } from '@glimmer/interfaces';
import { CONSTANT_TAG, Tag, validate, value, VersionedPathReference } from '@glimmer/reference';
import { ComponentDefinition, Invocation, WithDynamicLayout } from '@glimmer/runtime';
import { Destroyable, Opaque, Option } from '@glimmer/util';

import { Owner } from '@ember/-internals/owner';
import { generateControllerFactory } from '@ember/-internals/routing';
import { OwnedTemplateMeta } from '@ember/-internals/views';
import { TemplateFactory } from '../..';
import Environment from '../environment';
import RuntimeResolver from '../resolver';
import { RootReference } from '../utils/references';
import AbstractManager from './abstract';

// TODO: remove these stubbed interfaces when better typing is in place
interface EngineInstance extends Owner {
  boot(): void;
  destroy(): void;
}

interface EngineState {
  engine: EngineInstance;
  controller: any;
  self: RootReference<any>;
  tag: Tag;
}

interface EngineWithModelState extends EngineState {
  modelRef: VersionedPathReference<Opaque>;
  modelRev: number;
}

interface EngineDefinitionState {
  name: string;
  modelRef: VersionedPathReference<Opaque> | undefined;
}

const CAPABILITIES = {
  dynamicLayout: true,
  dynamicTag: false,
  prepareArgs: false,
  createArgs: false,
  attributeHook: false,
  elementHook: false,
  createCaller: true,
  dynamicScope: true,
  updateHook: true,
  createInstance: true,
};

class MountManager
  extends AbstractManager<EngineState | EngineWithModelState, EngineDefinitionState>
  implements
    WithDynamicLayout<EngineState | EngineWithModelState, OwnedTemplateMeta, RuntimeResolver> {
  getDynamicLayout(state: EngineState, _: RuntimeResolver): Invocation {
    let templateFactory = state.engine.lookup('template:application') as TemplateFactory;
    let template = templateFactory(state.engine);
    let layout = template.asLayout();

    return {
      handle: layout.compile(),
      symbolTable: layout.symbolTable,
    };
  }

  getCapabilities(): ComponentCapabilities {
    return CAPABILITIES;
  }

  create(environment: Environment, state: EngineDefinitionState) {
    if (DEBUG) {
      this._pushEngineToDebugStack(`engine:${state.name}`, environment);
    }

    // TODO
    // mount is a runtime helper, this shouldn't use dynamic layout
    // we should resolve the engine app template in the helper
    // it also should use the owner that looked up the mount helper.

    let engine = environment.owner.buildChildEngineInstance<EngineInstance>(state.name);

    engine.boot();

    let applicationFactory = engine.factoryFor(`controller:application`);
    let controllerFactory = applicationFactory || generateControllerFactory(engine, 'application');
    let controller: any;
    let self: RootReference<any>;
    let bucket: EngineState | EngineWithModelState;
    let tag: Tag;
    let modelRef = state.modelRef;
    if (modelRef === undefined) {
      controller = controllerFactory.create();
      self = new RootReference(controller);
      tag = CONSTANT_TAG;
      bucket = { engine, controller, self, tag };
    } else {
      let model = modelRef.value();
      let modelRev = value(modelRef.tag);
      controller = controllerFactory.create({ model });
      self = new RootReference(controller);
      tag = modelRef.tag;
      bucket = { engine, controller, self, tag, modelRef, modelRev };
    }

    return bucket;
  }

  getSelf({ self }: EngineState): VersionedPathReference<Opaque> {
    return self;
  }

  getTag(state: EngineState | EngineWithModelState): Tag {
    return state.tag;
  }

  getDestructor({ engine }: EngineState): Option<Destroyable> {
    return engine;
  }

  didRenderLayout(): void {
    if (DEBUG) {
      this.debugStack.pop();
    }
  }

  update(bucket: EngineWithModelState): void {
    let { controller, modelRef, modelRev } = bucket;
    if (!validate(modelRef.tag, modelRev!)) {
      let model = modelRef.value();
      bucket.modelRev = value(modelRef.tag);
      controller.set('model', model);
    }
  }
}

const MOUNT_MANAGER = new MountManager();

export class MountDefinition implements ComponentDefinition {
  public state: EngineDefinitionState;
  public manager = MOUNT_MANAGER;

  constructor(name: string, modelRef: VersionedPathReference<Opaque> | undefined) {
    this.state = { name, modelRef };
  }
}
