import {div, h1, h2, span, dl, dd, dt} from '@cycle/dom'
import isolate from '@cycle/isolate'
import xs from 'xstream'
import flattenConcurrently from 'xstream/extra/flattenConcurrently'
import {ListFilters} from './list-filter'

export function StatusView (sources) {
  let statuses$ = model({
      DOM: sources.DOM,
      network: network(sources.HTTP),
    });

  let ff = sel => text => dep => sel(dep).toLowerCase().includes(text);

  let filtered = ListFilters(statuses$.statuses$, sources.DOM,
    [ "service", ff(s => s["location"]) ]
  );

  return {
    DOM: view({
        statuses$: filtered.list$,
        filterDOMs: filtered.doms,
      }),
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
  .map((response$) => response$.replaceError((err) => {
        console.log(err);
        return xs.empty();
      }))
  .flatten()
  .map(res => res.body)
  .startWith({"Servers": []})
  .filter(servers => servers)
  .map(servers => {
      let statuses = [];
      for (let server of servers["Servers"]) {
        statuses.push(polling(5000, {
            url: server["URL"] + "/status",
            category: "status",
            serverName: server["ClusterName"],
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
  .map((response$) => response$.replaceError((err) => {
        console.log(err);
        return xs.empty();
      }))
  .compose(flattenConcurrently);

  return xs.combine(srv$, reports$)
  .fold((status, [srvrs, report]) => {
      if (!srvrs) {
        return status;
      }
      let name = report.request.serverName;

      status[name] = report.body;
      return status;
    }, {})
  .debug(s => console.log(s));
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
            instances: dep["NumInstances"],
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

  return {
    statuses$
  };
}

function view(state) {
  return xs.combine(state.statuses$, state.filterDOMs)
  .debug(a => console.log(a))
  .map(([serviceList,filters]) => {
      return div(".sous-status", [
          div(".filters", [dl([dt("Service"), dd(filters.service)] )]),
          div( serviceList.map(serviceView) )
        ])
    });
}

function serviceView(service) {
  return div(".service", {key: service.location}, [
      h1(service.location),
      div(".clusters", service.clusters.map(clusterView))
    ]);
}

function clusterView(cluster) {
  return div(".cluster", [
      h2(cluster.cluster),
      div(".reports", [
          div(".report.requested", [
              span("Requested"),
              span([cluster.current.version]),
              span([cluster.current.instances]),
            ]),
          div(".report.deployed", [
              span("Deployed"),
              span([cluster.completed.version]),
              span([cluster.completed.outcome]),
              span([cluster.completed.error]),
            ])
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
