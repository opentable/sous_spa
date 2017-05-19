import {div, ol, li, form, input} from '@cycle/dom'
import xs from 'xstream'

export function ListFilterDemo(sources) {
  let listFilter = ListFilter({
      DOM: sources.DOM,
      list$: xs.of(["Apple", "Pear", "Mango", "Kumquat", "Watermelon" ]),
      filterFactory: text => item => item.toLowerCase().includes(text)
    })

  return {
    DOM: xs.combine(listFilter.list$, listFilter.DOM)
    .map(([items, filterDom]) => (
        div([
          filterDom,
          ol(
            items.map(fruit => li(fruit))
          )
        ])
      ))
  }
}

function intent(domSource) {
  return {
    changeFilterText$: domSource.select(".filter-text").events('input').map(ev => ev.target.value),
  };
}

function model(ffn, intents, list$) {
  let filter$ = intents.changeFilterText$
  .startWith("")
  .map(ffn);

  return xs.combine(filter$.startWith(""), list$.startWith([]))
  .map(([ffn, list]) => {
      return list.filter(ffn);
    })
}

function view() {
  return xs.of(div(form(input(".filter-text"))))
}

export function ListFilter(sources) {
  const ffn = sources.filterFactory;
  const list$ = sources.list$;

  return {
    DOM: view(),
    list$: model(ffn, intent(sources.DOM), list$),
  }
}
