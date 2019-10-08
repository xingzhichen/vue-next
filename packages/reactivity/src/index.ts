export {
  ref, //ref api
  isRef, //判断是否是已经使用ref包装过的数据
  toRefs, //传入对象。将对象中的值都使用ref包装一层
  Ref, //ref的ts类型
  UnwrapRef //没有被ref包装的ts类型
} from './ref'
export {
  reactive, //reactive api
  isReactive, //判断是否reactive包装过一层
  readonly, //readonly api，和reactive大体一致，但是这个包装的对象是可读的。其实可以赋值。使用下面的unlock
  isReadonly, //判断是否是readonly包装过一层
  toRaw, //object和使用reactive包装过后的object1 有一个隐射关系(使用map)，调用这个函数可以根据object1得到object
  markReadonly, //调用这个函数，作用是将参数加入readonly名单，然后你使用reactive api包装对象时候的时候，自动判断在不在黑名单，在黑名单的话会调用readonly
  markNonReactive //调用这个函数，将参数加入名单。使用reactive  api的时候自动判断要包装的对象在不在名单。不在的话禁止包装，返回原对象
} from './reactive'
export {
  computed, // computed api
  ComputedRef, //computed返回的是一个readonly ref对象，正常compoted返回的ts类型
  WritableComputedRef, //当computed自行定义get和set的时候，返回的值是可写的，可写的ref ts类型
  WritableComputedOptions //自定义get和set的computed 传入的参数的ts 类型
} from './computed'
export {
  effect, //effect api
  stop, //effect所依赖的对象停止自动更新effect。将有关effect的依赖清楚
  pauseTracking, //停止目前所有的依赖收集
  resumeTracking, //恢复依赖收集
  ITERATE_KEY, //一个Symbol类型的值，依赖更新时候的一种类型
  ReactiveEffect, //effect的类型。类似于vue2的watcher。依赖的类型
  ReactiveEffectOptions, //调用effect的传参
  DebuggerEvent
} from './effect'
export { lock, unlock } from './lock' //加锁解锁是否可以修改可读类型
export { OperationTypes } from './operations' //数据更新的类型。add/delete等等
