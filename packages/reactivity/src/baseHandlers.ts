import { reactive, readonly, toRaw } from './reactive'
import { OperationTypes } from './operations'
import { track, trigger } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn } from '@vue/shared'
import { isRef } from './ref'

//Symbol上的可枚举和不可枚举的属性
const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(value => typeof value === 'symbol')
)

function createGetter(isReadonly: boolean) {
  return function get(target: any, key: string | symbol, receiver: any) {
    const res = Reflect.get(target, key, receiver) //拿到需要的值
    //如果是symbol类型，且是Symbol上的属性值，直接返回，不收集依赖
    if (typeof key === 'symbol' && builtInSymbols.has(key)) {
      return res
    }
    //如果已经使用ref包装过，直接返回res.value（调用value已经将当前依赖收集到ref包装后的对象里）
    if (isRef(res)) {
      return res.value
    }
    //依赖收集
    track(target, OperationTypes.GET, key)
    //返回的值是对象的话，对值也进行监听。
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res)
        : reactive(res)
      : res
  }
}

function set(
  target: any,
  key: string | symbol,
  value: any,
  receiver: any
): boolean {
  //格式化值，主要是判断这个值是不是已经相应式的。
  value = toRaw(value)
  const hadKey = hasOwn(target, key) //赋值的key是否存在
  const oldValue = target[key] //旧的值
  //这里的逻辑:
  //记得之前get里面，我们判断，值是ref包装的就直接返回，不进行收集依赖。所以obj.a=ref(1)。我们读取key值a
  //的时候，依赖是没有被收集的，依赖只被收集到ref(1)中。当我们重新赋值obj.a=1的时候，因为key值为a的依赖没有收集
  //所以无法更新，下面这个逻辑就是判断这种情况。然后强制给ref(1)重新赋值，触发set，依赖更新。说实话，我觉着这样处理很不好
  //因为我们强制更新ref(1)，其他地方使用这个ref。那么也会被强制更新。
  if (isRef(oldValue) && !isRef(value)) {
    oldValue.value = value
    return true
  }
  //赋值
  const result = Reflect.set(target, key, value, receiver)
  //正常来说receiver恒等于target，除非手动改receiver，但是我没发现源码什么地方可以改receiver
  if (target === toRaw(receiver)) {
    //开发环境记录的信息，追踪用
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key, extraInfo)
      } else if (value !== oldValue) {
        trigger(target, OperationTypes.SET, key, extraInfo)
      }
    } else {
      //之前存在属性的话类型就是set，不存在的话类型就是add，下面我们看这两个上面区别
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else if (value !== oldValue) {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

function deleteProperty(target: any, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = target[key]
  const result = Reflect.deleteProperty(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function has(target: any, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, OperationTypes.HAS, key)
  return result
}

function ownKeys(target: any): (string | number | symbol)[] {
  track(target, OperationTypes.ITERATE)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<any> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<any> = {
  get: createGetter(true),

  set(target: any, key: string | symbol, value: any, receiver: any): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${key as any}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return set(target, key, value, receiver)
    }
  },

  deleteProperty(target: any, key: string | symbol): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${key as any}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return deleteProperty(target, key)
    }
  },

  has,
  ownKeys
}
