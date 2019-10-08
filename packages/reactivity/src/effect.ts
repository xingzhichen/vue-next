import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

export interface ReactiveEffect {
  (): any
  isEffect: true
  active: boolean
  raw: Function
  deps: Array<Dep>
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface DebuggerEvent {
  effect: ReactiveEffect
  target: any
  type: OperationTypes
  key: string | symbol | undefined
}

export const activeReactiveEffectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

export function effect(
  fn: Function,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect {
  if ((fn as ReactiveEffect).isEffect) {
    fn = (fn as ReactiveEffect).raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.onStop) {
      effect.onStop()
    }
    effect.active = false
  }
}

function createReactiveEffect(
  fn: Function,
  options: ReactiveEffectOptions
): ReactiveEffect {
  const effect = function effect(...args): any {
    return run(effect as ReactiveEffect, fn, args)
  } as ReactiveEffect
  effect.isEffect = true
  effect.active = true
  effect.raw = fn
  effect.scheduler = options.scheduler
  effect.onTrack = options.onTrack
  effect.onTrigger = options.onTrigger
  effect.onStop = options.onStop
  effect.computed = options.computed
  effect.deps = []
  return effect
}

function run(effect: ReactiveEffect, fn: Function, args: any[]): any {
  if (!effect.active) {
    return fn(...args)
  }
  if (activeReactiveEffectStack.indexOf(effect) === -1) {
    cleanup(effect)
    try {
      activeReactiveEffectStack.push(effect)
      return fn(...args)
    } finally {
      activeReactiveEffectStack.pop()
    }
  }
}

function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true

export function pauseTracking() {
  shouldTrack = false
}

export function resumeTracking() {
  shouldTrack = true
}

export function track(
  target: any,
  type: OperationTypes,
  key?: string | symbol
) {
  //全局的一个锁控制是否依赖收集
  if (!shouldTrack) {
    return
  }
  //当前活动的effect，类似于老版本的watcher, render就是一个watcher,这里render，computed等都是effect
  const effect = activeReactiveEffectStack[activeReactiveEffectStack.length - 1]
  if (effect) {
    //这个只有当调用的是set和map等特殊数据结构的'keys', 'values', 'entries‘等方法时候，type才会为iterate。
    //其实我们所有依赖的储存都是map的形式。key是你get的key，value就是依赖数组，比如你读obj.a 那么key就是a，value就是
    //所有读obj.a的依赖，按理我们调用keys，values，entries等的时候 key应该是不同的值，但是事实上这些key对应的依赖都应该
    //是同步更新，也就是说调用keys的依赖更新，调用values的依赖也必须更新。所以这里将他们都拿一个值存储
    //这里的type一般是add，del等等，当调用'keys', 'values', 'entries‘的时候是iterate
    if (type === OperationTypes.ITERATE) {
      key = ITERATE_KEY
    }
    //targetMap存储的key是对象，value也是一个map，下面会解释这个map上面东西
    let depsMap = targetMap.get(target)
    //没有的话，新建一个map
    if (depsMap === void 0) {
      targetMap.set(target, (depsMap = new Map()))
    }
    //depsmap的key是调用的key值，value是一个set。储存所有的依赖，
    let dep = depsMap.get(key as string | symbol)
    //没有的话，新建一个set,所以就算访问不存在的属性，也会将依赖收集。
    if (!dep) {
      depsMap.set(key as string | symbol, (dep = new Set()))
    }
    //收集依赖。
    if (!dep.has(effect)) {
      dep.add(effect) //这里是依赖收集
      effect.deps.push(dep) //因为依赖也有个deps数组，将当前属性值所有的依赖存入正在收集的依赖中。computed的时候要用，到时会就懂为什么这里收集
      //开发环境追踪，
      if (__DEV__ && effect.onTrack) {
        effect.onTrack({
          effect,
          target,
          type,
          key
        })
      }
    }
  }
}

export function trigger(
  target: any,
  type: OperationTypes,
  key?: string | symbol,
  extraInfo?: any
) {
  //拿到target的所有的依赖map(key是对象的各个属性，value是依赖)
  const depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  //储存一般的effect
  const effects: Set<ReactiveEffect> = new Set()
  //储存computed生成的effect
  const computedRunners: Set<ReactiveEffect> = new Set()
  //当type为clear时候，所有属性的依赖都要更新，因为所有属性都被清空
  if (type === OperationTypes.CLEAR) {
    depsMap.forEach(dep => {
      //添加依赖
      addRunners(effects, computedRunners, dep)
    })
  } else {
    //添加依赖
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key as string | symbol))
    }
    //当数组的时候触发更新， add和delete都会引起length的变化，所以判断是数组且更新类型是add和delete的时候，额外更新调用了属性lengrh的依赖。
    //当不为数组且是add或者delete的时候，更新key为iterate的依赖，这时候有可能是set和map等特殊类型，因为更新类型是add和delete的时候。
    //他们的size，keys等等属性的依赖都需要跟着变化
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  //运行依赖
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  //注意这里先运行computed生成的依赖，然后在运行普通的依赖，因为普通的依赖有可能需要读取computed的新值
  computedRunners.forEach(run)
  effects.forEach(run)
}

function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

//批量更新依赖
function scheduleRun(
  effect: ReactiveEffect,
  target: any,
  type: OperationTypes,
  key: string | symbol | undefined,
  extraInfo: any
) {
  if (__DEV__ && effect.onTrigger) {
    effect.onTrigger(
      extend(
        {
          effect,
          target,
          key,
          type
        },
        extraInfo
      )
    )
  }

  if (effect.scheduler !== void 0) {
    effect.scheduler(effect)
  } else {
    effect()
  }
}
