import {div} from '@cycle/dom'
import xs from 'xstream'

export function GDMTable (sources) {
  const vtree$ = xs.of(
    div('My Awesome Cycle.js app')
  )
  const sinks = {
    DOM: vtree$
  }
  return sinks
}
