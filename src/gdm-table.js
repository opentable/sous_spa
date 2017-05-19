import {div, table, th, tr, td} from '@cycle/dom'
import isolate from '@cycle/isolate'
import xs from 'xstream'
import {ListFilter} from './list-filter'

function polling(interval, req) {
  return xs.periodic(interval)
  .map(() => req)
  .startWith(req);
}

function network(httpSource) {
  return httpSource.select("gdm").flatten();
}

function model(inputs) {
  let gdm = inputs.network
  .map(res => res.body["Deployments"]);

  let ff = sel => text => dep => sel(dep).toLowerCase().includes(text);

  let clusterFilter = isolate(ListFilter, "cluster")({
      list$: gdm,
      DOM: inputs.DOM,
      filterFactory: ff(d => d["ClusterName"])
    })

  let locationFilter = isolate(ListFilter, "location")({
      list$: clusterFilter.list$,
      DOM: inputs.DOM,
      filterFactory: ff(d => d["SourceID"]["Location"])
    })

  let filters$ = xs.combine(clusterFilter.DOM, locationFilter.DOM)
  .map( ([cluster, location]) => {
      return { cluster, location };
    }
  );

  return {
    gdm$: locationFilter.list$,
    filters: filters$
  }
}

function view(state) {
  return xs.combine(state.gdm$, state.filters)
  .filter(([j, filters]) => filters != undefined)
  .map(([json, filters]) =>
    div([
      div('The Sous GDM'),
      gdmTable(json, filters)
    ])
  );
}

export function GDMTable (sources) {
  let req = {
    url: 'http://sous.otenv.com/gdm',
    category: "gdm",
  }

  return {
    DOM: view(model({
          DOM: sources.DOM,
          network: network(sources.HTTP),
        })),
    HTTP: polling(5000, req),
  };
}

function gdmTable(gdm, filters) {
  if(gdm == null) {
    return "No results yet"
  }
  return table(
    [
      tr(".main-heading", [ "Cluster", "Source Location", "Version", "Instances"].map(heading => th(heading))),
      tr(".filter-fields", [ filters.cluster, filters.location ].map(input => td(input))),
    ].concat(
      gdm.sort(compareDeps)
      .map(rowsForDeployment)
      .reduce((allRows, forDep) => allRows.concat(forDep), [])));
}

function rowsForDeployment(dep) {
  return [
    tr(".dep-main", [ td(dep["ClusterName"]), td(dep["SourceID"]["Location"]), td(dep["SourceID"]["Version"]), td(dep["NumInstances"]), ]),
    tr(".dep-env.header", th("", {attrs: {colspan: 4}}, "Environment variables")),
    tr(".dep-env.names", Object.getOwnPropertyNames(dep["Env"]).map(k => th(k))),
    tr(".dep-env.values", Object.getOwnPropertyNames(dep["Env"]).map(k => td(dep["Env"][k])))
  ]
}

function compareDeps(left, right) {
  if(left["ClusterName"] < right["ClusterName"]) {
    return -1
  }
  if(left["ClusterName"] > right["ClusterName"]) {
    return 1
  }

  if (left["SourceID"]["Location"] < right["SourceID"]["Location"]){
    return -1
  }
  if (left["SourceID"]["Location"] > right["SourceID"]["Location"]){
    return 1
  }
  return 0
}
