import {div, h1, h2, span} from '@cycle/dom'
import isolate from '@cycle/isolate'
import xs from 'xstream'
import {ListFilter} from './list-filter'

export function StatusView (sources) {
  return {
    DOM: view(model({
          DOM: sources.DOM,
          network: network(sources.HTTP),
        })),
    HTTP: queries(sources.HTTP)
  };
}

function polling(interval, req) {
  return xs.periodic(interval)
  .map(() => req)
  .startWith(req);
}

function queries(http) {
  let servers$ = polling(5000, {
    url: 'http://sous.otenv.com/servers',
    category: "servers",
  });

  let statuses$ = http.select("servers")
  .flatten()
  .map(res => res.body)
  .startWith({"Servers": []})
  .filter(servers => servers)
  .map(servers => {
      let statuses = [];
      for (let server of servers["Servers"]) {
        statuses.push(polling(5000, {
            url: server["URL"] + "/status",
            category: "status"
          }));
      }
      return xs.merge(...statuses)
    })
  .flatten();

  return xs.merge(servers$, statuses$);
}

function network(httpSource) {
  let srv$ = httpSource.select("servers")
  .flatten()
  .map(srvr => srvr.body["Servers"]);

  let reports$ = httpSource
  .select("status")
  .fold((all$, rep$) => xs.merge(all$, rep$), xs.empty())
  .flatten();

  return xs.combine(srv$, reports$)
  .fold((status, [srvrs, report]) => {
      if (!srvrs) {
        return status;
      }
      let name = null;

      for (let srvr of srvrs) {
        if (report.req.url.includes(srvr["URL"])) {
          name = srvr["ClusterName"];
          break;
        }
      }

      if (name == null) {
        return status;
      }

      status[name] = report.body;
      return status;
    }, {});
}

function getService(services, loc) {
  let service = {location: loc, clusters: {}};
  if (services.hasOwnProperty(loc)) {
    service = services[loc];
  } else {
    services[loc] = service;
  }
  return service;
}

function getCluster(service, name) {
  let cluster = {cluster: name};
  if (service.clusters.hasOwnProperty(name)) {
    cluster = service.clusters[name];
  } else {
    service.clusters[name] = cluster;
  }
  return cluster;
}

function serviceName(dep) {
  let loc = dep["SourceID"]["Location"];
  let flavor = dep["Flavor"];

  if (flavor != "") {
    return loc + "~" + flavor;
  } else {
    return loc;
  }
}

function model(sources) {
  let statuses$ = sources.network
  .map(status => {
      let services = { };
      for (let name in status) {
        let clusterStatus = status[name];
        for (let dep of clusterStatus["Completed"]["Intended"]) {
          let loc = serviceName(dep);
          let service = getService(services, loc);
          let report = getCluster(service, name);

          service.owners = dep["Owners"];
          service.flavor = dep["Flavor"];

          report.completed = {
            version: dep["SourceID"]["Version"],
            env: dep["Env"],
            resources: dep["Resources"],
          }
        }
        for (let log of clusterStatus["Completed"]["Log"]) {
          let loc = log["ManifestID"]
          let service = getService(services, loc);
          let report = getCluster(service, name);

          report.completed = {
            outcome: log["Desc"],
            error: log["Error"],
          }
        }
        for (let dep of clusterStatus["Deployments"]) {
          let loc = serviceName(dep);
          let service = getService(services, loc);
          let report = getCluster(service, name);

          service.owners = dep["Owners"];
          service.flavor = dep["Flavor"];

          report.current = {
            version: dep["SourceID"]["Version"],
            env: dep["Env"],
            resources: dep["Resources"],
          }
        }
      }

      let ss = [];
      for (let name in services) {
        let service = services[name];
        let cl = [];
        for (let c in service.clusters) {
          cl.push(service.clusters[c]);
        }
        service.clusters = cl;
        ss.push(service);
      }
      return ss;
    });
  /*
  .map(res => res.body["Deployments"]);

  let ff = sel => text => dep => sel(dep).toLowerCase().includes(text);

  let clusterFilter = isolate(ListFilter, "cluster")({
      list$: gdm,
      DOM: sources.DOM,
      filterFactory: ff(d => d["ClusterName"])
    })

  let locationFilter = isolate(ListFilter, "location")({
      list$: clusterFilter.list$,
      DOM: sources.DOM,
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
  */

  return {
    statuses$
  };
}

function view(state) {
  //return xs.combine(state.statuses$)
  return state.statuses$
  .map((serviceList) => div( serviceList.map(serviceView)));
  /*
  return xs.combine(state.gdm$, state.filters)
  .filter(([j, filters]) => filters != undefined)
  .map(([json, filters]) =>
    div([
      div('Sous Statuses'),
      statusTable(json, filters)
    ])
  );
  */
}

function serviceView(service) {
  return div([
      h1(service.location),
      div(service.clusters.map(clusterView))
    ]);
}

function clusterView(cluster) {
  return div([
      h2(cluster.cluster),
      div([
          span("Requested"),
          span([cluster.current.version]),
        ]),
      div([
          "Deployed",
          span([cluster.completed.version]),
          span([cluster.completed.outcome]),
          span([cluster.completed.error]),
        ])
    ]);
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
