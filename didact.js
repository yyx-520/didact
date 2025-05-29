// 汇集了函数节点和普通原生html节点
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map(child =>
        typeof child === "object"
          ? child
          : createTextElement(child)
      ),
    },
  }
}

function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  }
}

function createDom(fiber) {
  const dom =
    fiber.type == "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type)

  updateDom(dom, {}, fiber.props)

  return dom
}

const isEvent = key => key.startsWith("on")
const isProperty = key =>
  key !== "children" && !isEvent(key)
const isNew = (prev, next) => key =>
  prev[key] !== next[key]
const isGone = (prev, next) => key => !(key in next)
// diff算法
function updateDom(dom, prevProps, nextProps) {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(
      key =>
        !(key in nextProps) ||
        isNew(prevProps, nextProps)(key)
    )
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.removeEventListener(
        eventType,
        prevProps[name]
      )
    })

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = ""
    })

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      dom[name] = nextProps[name]
    })

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.addEventListener(
        eventType,
        nextProps[name]
      )
    })
}

// 提交当前fiberroot
function commitRoot() {
  // 执行删除
  deletions.forEach(commitWork)
  // 提交工作单元，继续执行
  commitWork(wipRoot.child)
  currentRoot = wipRoot
  wipRoot = null
}
// 变更推送到真实 DOM 的过程，主要在 commitWork（递归遍历 Fiber 树，根据 effectTag 插入/更新/删除 DOM）和 updateDom（具体设置 DOM 属性和事件）这两处完成。
//树用链表实现很快
function commitWork(fiber) {
  if (!fiber) {
    return
  }

  let domParentFiber = fiber.parent
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent
  }
  const domParent = domParentFiber.dom

  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    // 真实挂载上去
    domParent.appendChild(fiber.dom)
  } else if (
    fiber.effectTag === "UPDATE" &&
    fiber.dom != null
  ) {
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props
    )
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent)
  }

  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom)
  } else {
    commitDeletion(fiber.child, domParent)
  }
}

function render(element, container) {
  console.log("rendering", element)
  // 根节点的 fiber
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  }
  deletions = []
  nextUnitOfWork = wipRoot
}
// 涉及到调度器、调和器、提交

let nextUnitOfWork = null // 下一个工作单元，执行fiber的
let currentRoot = null // 当前的根fiber，保存上一次渲染的结果
let wipRoot = null // 工作中的根fiber，保存当前正在渲染的fiber树，存储任务
let deletions = null // 删除的fiber列表

// 事件循环，调度器，没时间了就马上停止，等有时间再执行
// deadline 是浏览器提供的一个时间片，表示本帧还剩多少时间
// Fiber 让渲染“可中断”，牺牲了“单次最快”，换来了“整体不卡顿、用户体验更好”，这就是现代前端性能优化的核心思想
// 先去执行优先级高的任务了，因为浏览器不能卡在你js这里，它还要干很多其他的事，一个tab标签是一个浏览器进程
function workLoop(deadline) {
  let shouldYield = false
  // 实现可中断渲染
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(
      nextUnitOfWork
    )
    shouldYield = deadline.timeRemaining() < 1
  }

  if (!nextUnitOfWork && wipRoot) {
    // 如果没有下一个工作单元，说明已经完成了所有的工作
    // 提交工作单元，把变更应用到 DOM 上，前面都是更新到fiber树的虚拟树上面
    commitRoot()
  }
  // 通过这个判断浏览器是否有空回调
  requestIdleCallback(workLoop)
}

// 等浏览器有空再执行
// 浏览器提供的一个 API
requestIdleCallback(workLoop)

// 执行工作单元
function performUnitOfWork(fiber) {
  const isFunctionComponent =
    fiber.type instanceof Function
  // 函数组件
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)
  } else {
    updateHostComponent(fiber)
  }
  if (fiber.child) {
    return fiber.child
  }
  let nextFiber = fiber
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling // 如果有兄弟节点，返回兄弟节点
    }
    nextFiber = nextFiber.parent
  }
}

let wipFiber = null
let hookIndex = null

function updateFunctionComponent(fiber) {
  wipFiber = fiber
  hookIndex = 0
  wipFiber.hooks = [] // 初始化函数组件的 hooks，记录状态
  const children = [fiber.type(fiber.props)] // 获取虚拟dom，并且执行hooks，更新state
  // state更新后，重新挂载dom
  reconcileChildren(fiber, children)
}

// setsate触发fiber工作流，触发重新执行usestae的hooks的actions队列，更新值
function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex] // 当前的wipfiber
  const hook = {
    state: oldHook ? oldHook.state : initial, // 拿到上一次的值
    queue: [], //多次aciton的队列，改变state的action
  }

  const actions = oldHook ? oldHook.queue : []
  actions.forEach(action => {
    hook.state = action(hook.state)
  })
  // 以前是直接触发dom更新，现在是触发fiber工作流，然后fiber工作流会等到浏览器空闲的时候去执行（相当于代理了一层，当浏览器有空的时候才会去更新）
  const setState = action => {
    hook.queue.push(action)
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    }
    // 整个更新执行完毕
    nextUnitOfWork = wipRoot
    deletions = []
  }

  wipFiber.hooks.push(hook)
  hookIndex++
  return [hook.state, setState]
}

// 更新html原生标签
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }
  // 调和器，diff变更打标记
  reconcileChildren(fiber, fiber.props.children)
}
// 打标，更新虚拟dom
// 调和器
//链表结构让遍历和 diff 更快。
// 只比较同级节点，避免全树递归。 剪枝
// 先打标记，后批量提交，减少 DOM 操作。
// 可中断，保证响应性
// 只对比同一个父节点的同级节点
function reconcileChildren(wipFiber, elements) {
  let index = 0
  let oldFiber =
    wipFiber.alternate && wipFiber.alternate.child
  let prevSibling = null
  // 更新、替换、删除
  while (
    index < elements.length ||
    oldFiber != null
  ) {
    const element = elements[index]
    let newFiber = null

    const sameType =
      oldFiber &&
      element &&
      element.type == oldFiber.type

    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      }
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      }
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION"
      deletions.push(oldFiber)
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }
    // 构建fiber树
    if (index === 0) {
      wipFiber.child = newFiber
    } else if (element) {
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }
}

const Didact = {
  createElement,
  render,
  useState,
}

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1)
  return Didact.createElement(
    "h1",
    { onClick: () => setState(c => c + 1) },
    "Count: ", state
  )
}
// const element = <Counter />
const element = Didact.createElement(Counter, null)
const container = document.getElementById("root")
Didact.render(element, container)
