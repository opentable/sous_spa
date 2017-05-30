import {div, ol, li, form, input} from '@cycle/dom'
import xs from 'xstream'
import isolate from '@cycle/isolate'

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


/*
 * ListFilters(list, sourceDOM,
 * [ "cluster", ff(d=>d["ClusterName"])],
 * [ "location", ff(d => d["SourceID"]["Location"])]
 * )
 */

export function ListFilters(list, sourcesDOM, ...filterDesc) {
  let filtering = filterDesc.reduce(
    (filtered, [name, ff]) => {
      let filter = isolate(ListFilter, name)({
          list$: filtered.list,
          DOM: sourcesDOM,
          filterFactory: ff,
        });
      return {
        list: filter.list$,
        doms: filtered.doms.concat(filter.DOM),
      };
    }, {list: list, doms: []});


  let filter$ = xs.combine(...filtering.doms)
  .map( doms => {
      return doms.reduce((domObj, dom, idx) => {
          let [name, _] = filterDesc[idx];
          domObj[name] = dom;
          return domObj;
        }, {});
    });

  return {
    list$: filtering.list,
    doms: filter$,
  };
}
