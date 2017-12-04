import { getUniqueId, conflict, deepCopy } from '../utils'
import { LOWERCASE_TAGS } from '../config'
import StateRender from '../parser/StateRender'
import { tokenizer } from '../parser/parse'
import selection from '../selection'
import { findNearestParagraph } from '../utils/domManipulate'

import enterCtrl from './enterCtrl'

const ctrls = [
  enterCtrl
]

const INLINE_UPDATE_REG = /^([*+-]\s(\[\s\]\s)?)|^(\d+\.\s)|^(#{1,6})[^#]+|^(>).+/

export const newABlock = (set, parent = null, preSibling = null, nextSibling = null, text = '', depth = 0, type = 'p') => {
  const key = getUniqueId(set)
  return {
    key,
    parent,
    preSibling,
    nextSibling,
    text,
    children: [],
    depth,
    type
  }
}

// deep first search
const convertBlocksToArray = blocks => {
  const result = []
  blocks.forEach(block => {
    result.push(block)
    if (block.children.length) {
      result.push(...convertBlocksToArray(block.children))
    }
  })
  return result
}

class ContentState {
  constructor (blocks) {
    this.keys = new Set()
    this.blocks = blocks || [ newABlock(this.keys) ]
    this.stateRender = new StateRender()
    const lastBlock = this.getLastBlock()
    this.cursor = {
      key: lastBlock.key,
      range: {
        start: lastBlock.text.length,
        end: lastBlock.text.length
      }
    }
  }

  render () {
    const { blocks, cursor } = this
    const activeBlock = this.getActiveBlockKey()
    return this.stateRender.render(blocks, cursor, activeBlock)
  }

  updateState () {
    const node = selection.getSelectionStart()
    const paragraph = findNearestParagraph(node)
    const text = paragraph.textContent
    const selectionState = selection.exportSelection(paragraph)
    const block = this.getBlock(paragraph.id)
    block.text = text
    const { key, range } = this.cursor
    const { start: oldStart, end: oldEnd } = range
    const { start, end } = selectionState
    let needRender = false

    if (key !== block.key || start !== oldStart || end !== oldEnd) {
      Object.assign(this.cursor.range, selectionState)
      this.cursor.key = block.key
      needRender = true
    }

    if (this.checkNeedRender(block) || this.checkInlineUpdate(block) || needRender) {
      this.render()
    }
  }

  checkNeedRender (block) {
    const { start: cStart, end: cEnd } = this.cursor.range
    const tokens = tokenizer(block.text)
    let i
    const len = tokens.length
    const textLen = block.text.length
    for (i = 0; i < len; i++) {
      const token = tokens[i]
      if (token.type === 'text') continue
      const { start, end } = token.range
      if (conflict([Math.max(0, start - 1), Math.min(textLen, end + 1)], [cStart, cEnd])) return true
    }
    return false
  }

  checkInlineUpdate (block) {
    const { text } = block
    const [match, disorder, tasklist, order, header, blockquote] = text.match(INLINE_UPDATE_REG) || []
    let newType
    switch (true) {
      case !!disorder:
        this.updateList(block, 'disorder', disorder)
        return true
        // maybe no needed `break`

      case !!tasklist:
        this.updateList(block, 'tasklist', disorder) // tasklist is one type of disorder.
        return true
        // maybe no needed `break`

      case !!order:
        this.updateList(block, 'order', order)
        return true
        // maybe no needed `break`

      case !!header:
        newType = `h${header.length}`
        if (block.type !== newType) {
          block.type = newType // updateHeader
          return true
        }
        break

      case !!blockquote:
        this.updateBlockQuote(block)
        return true

      case !match:
      default:
        newType = LOWERCASE_TAGS.p
        if (block.type !== newType) {
          block.type = newType // updateP
          return true
        }
        break
    }

    return false
  }

  updateList (block, type, marker) {
    const parent = this.getParent(block)
    const preSibling = this.getPreSibling(block.key)
    const wrapperTag = type === 'order' ? 'ol' : 'ul'
    const newText = block.text.substring(marker.length)
    const { start, end } = this.cursor.range
    let newPblock

    block.text = ''
    block.type = 'li'

    const cloneBlock = deepCopy(block)

    if ((parent && parent.type !== wrapperTag) || (preSibling && preSibling.type !== wrapperTag) || !parent) {
      cloneBlock.key = getUniqueId(this.keys)
      cloneBlock.parent = block.key
      cloneBlock.depth = block.depth + 1
      newPblock = newABlock(this.keys, cloneBlock.key, null, null, newText, cloneBlock.depth + 1, 'p')
      block.type = wrapperTag
      block.children = [ cloneBlock ]
      cloneBlock.children = [ newPblock ]
    } else if (preSibling && preSibling.type === wrapperTag) {
      this.removeBlock(block)
      cloneBlock.parent = preSibling.key
      cloneBlock.depth = preSibling.depth + 1

      if (preSibling.children.length) {
        const lastChild = preSibling.children[preSibling.children.length - 1]
        cloneBlock.preSibling = lastChild.key
      }

      preSibling.children.push(cloneBlock)
      newPblock = newABlock(this.keys, cloneBlock.key, null, null, newText, cloneBlock.depth + 1, 'p')
      cloneBlock.children = [ newPblock ]
    } else {
      newPblock = newABlock(this.keys, block.key, null, null, newText, block.depth + 1, 'p')
      block.children = [ newPblock ]
    }

    this.cursor = {
      key: newPblock.key,
      range: {
        start: Math.max(0, start - marker.length),
        end: Math.max(0, end - marker.length)
      }
    }
  }

  updateBlockQuote (block) {
    const newText = block.text.substring(1).trim()
    const newPblock = newABlock(this.keys, block.key, null, null, newText, block.depth + 1, 'p')
    block.type = 'blockquote'
    block.text = ''
    block.children = [ newPblock ]
    const { start, end } = this.cursor.range
    this.cursor = {
      key: newPblock.key,
      range: {
        start: Math.max(0, start - 1),
        end: Math.max(0, end - 1)
      }
    }
  }

  // getBlocks
  getBlocks () {
    return this.blocks
  }

  getCursor () {
    return this.cursor
  }

  getArrayBlocks () {
    return convertBlocksToArray(this.blocks)
  }

  getBlock (key) {
    return this.getArrayBlocks().filter(block => block.key === key)[0]
  }

  getParent (block) {
    if (block.parent) {
      return this.getBlock(block.parent)
    }
    return null
  }

  getPreSibling (key) {
    const block = this.getBlock(key)
    return block.preSibling ? this.getBlock(block.preSibling) : null
  }

  getNextSibling (key) {
    const block = this.getBlock(key)
    return block.nextSibling ? this.getBlock(block.nextSibling) : null
  }

  getFirstBlock () {
    const arrayBlocks = this.getArrayBlocks()
    if (arrayBlocks.length) {
      return arrayBlocks[0]
    } else {
      throw new Error('article need at least has one paragraph')
    }
  }

  removeBlock (block) {
    const remove = (blocks, block) => {
      const len = blocks.length
      let i
      for (i = 0; i < len; i++) {
        if (blocks[i].key === block.key) {
          const preSibling = this.getBlock(block.preSibling)
          const nextSibling = this.getBlock(block.nextSibling)

          if (preSibling) {
            preSibling.nextSibling = nextSibling ? nextSibling.key : null
          }
          if (nextSibling) {
            nextSibling.preSibling = preSibling ? preSibling.key : null
          }

          return blocks.splice(i, 1)
        } else {
          if (blocks[i].children.length) {
            remove(blocks[i].children, block)
          }
        }
      }
    }
    remove(this.blocks, block)
  }

  getActiveBlockKey () {
    let block = this.getBlock(this.cursor.key)
    while (block.parent) {
      block = this.getBlock(block.parent)
    }
    return block.key
  }

  insertAfter (newBlock, oldBlock) {
    const siblings = oldBlock.parent ? this.getBlock(oldBlock.parent).children : this.blocks
    const index = this.findIndex(siblings, oldBlock)
    siblings.splice(index + 1, 0, newBlock)
    oldBlock.nextSibling = newBlock.key
    newBlock.parent = oldBlock.parent
    newBlock.preSibling = oldBlock.key
    newBlock.nextSibling = siblings[index + 2] ? siblings[index + 2].key : null
  }

  insertBefore (newBlock, oldBlock) {
    const siblings = oldBlock.parent ? this.getBlock(oldBlock.parent).children : this.blocks
    const index = this.findIndex(siblings, oldBlock)
    siblings.splice(index, 0, newBlock)
    oldBlock.preSibling = newBlock.key
    newBlock.parent = oldBlock.parent
    newBlock.preSibling = siblings[index - 1] ? siblings[index - 1].key : null
    newBlock.nextSibling = oldBlock.key
  }

  findIndex (children, block) {
    const len = children.length
    let i
    for (i = 0; i < len; i++) {
      if (children[i].key === block.key) return i
    }
    return -1
  }

  appendChild (parent, block) {
    const len = parent.children.length
    const lastChild = parent.children[len - 1]
    parent.children.push(block)
    block.parent = parent.key
    if (lastChild) {
      block.preSibling = lastChild.key
    }
  }

  isFirstChild (block) {
    return !block.preSibling
  }

  isLastChild (block) {
    return !block.nextSibling
    // const parent = this.getBlock(block.parent)
    // const index = this.findIndex(parent.children, block)
    // return index === parent.children.length - 1
  }

  isOnlyChild (block) {
    return !block.nextSibling && !block.preSibling
    // const parent = this.getBlock(block.parent)
    // return parent.children.length === 1
  }

  getLastBlock () {
    const arrayBlocks = this.getArrayBlocks()
    const len = arrayBlocks.length
    return arrayBlocks[len - 1]
  }
}

ctrls.forEach(ctrl => ctrl(ContentState))

export default ContentState