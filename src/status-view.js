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

function selectPolling(http, group) {
  return http.select(group)
  .map((response$) => response$.replaceError((err) => {
        console.log(group, err);
        return xs.empty();
      }))
  .compose(flattenConcurrently)
}

function queries(http) {
  let servers$ = polling(5000, {
    url: 'http://sous.otenv.com/servers',
    category: "servers",
  });


  let statuses$ = selectPolling(http, "servers")
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
  let srv$ = selectPolling(httpSource, "servers")
  .map(srvr => srvr.body["Servers"]);

  let reports$ = selectPolling(httpSource, "status")

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
  let cluster = {
    cluster: name,
    current: {},
    inprogress: {},
    completed: {}
  };
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

function extractResolveLog(clusterStatus, services, from, to) {
  let fromStatus = {};
  if (clusterStatus[from] !== null) {
    fromStatus = clusterStatus[from];
  }

  let intended = [];
  if (fromStatus["Intended"] != null) {
    intended = fromStatus["Intended"];
  }

  for (let dep of intended) {
    let loc = serviceName(dep);
    let service = getService(services, loc);
    let report = getCluster(service, dep.ClusterName);

    service.owners = dep["Owners"];
    service.flavor = dep["Flavor"];

    report[to] = {
      version: dep["SourceID"]["Version"],
      env: dep["Env"],
      resources: dep["Resources"],
    }
  }

  let logs = [];
  if (fromStatus["Log"] != null) {
    logs = fromStatus["Log"];
  }

  for (let log of logs) {
    let loc = log["ManifestID"]
    let service = getService(services, loc);
    let report = getCluster(service, log.Cluster);

    report[to] = {
      outcome: log["Desc"],
      error: log["Error"],
    }
  }
}


function extractDepState(clusterStatus, services) {
  let deps = [];
  if (clusterStatus["Deployments"] != null) {
    deps = clusterStatus["Deployments"];
  }
  for (let dep of deps) {
    let loc = serviceName(dep);
    let service = getService(services, loc);
    let report = getCluster(service, dep.ClusterName);

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

function interpret(services) {
  for (let name in services) {
    let service = services[name]
    for (let cname in service.clusters) {
      let cluster = service.clusters[cname]
      let resolve = cluster.completed;
      if (cluster.inprogress && cluster.inprogress.outcome) {
        resolve = cluster.inprogress
      }

      cluster.interpretation = {
        status: "Unknown",
        error: { "String": "No resolution found" },
        version: "",
        resolve: resolve,
      }

      if (/unchanged/.exec(resolve.outcome)) {
        cluster.interpretation = {
          status: "Stable",
          error: resolve.error,
          version: cluster.current.version,
          resolve: resolve,
        }
      } else if (/coming/.exec(resolve.outcome)) {
        cluster.interpretation = {
          status: "Pending",
          error: resolve.error,
          version: cluster.current.version,
          resolve: resolve,
        }
      } else if (/created/.exec(resolve.outcome)) {
        cluster.interpretation = {
          status: "Creating",
          error: resolve.error,
          version: cluster.current.version,
          resolve: resolve,
        }
      } else if (/deleted/.exec(resolve.outcome)) {
        cluster.interpretation = {
          status: "Deleting",
          error: resolve.error,
          version: cluster.current.version,
          resolve: resolve,
        }
      } else if (/updated/.exec(resolve.outcome)) {
        cluster.interpretation = {
          status: "Deploying",
          error: resolve.error,
          resolve: resolve,
          versions:  {
            from: resolve.version,
            to: cluster.current.version,
          }
        }
      } else {
        if (resolve.error != null) {
          cluster.interpretation.error = resolve.error
        }
      }
    }
  }
}

function model(sources) {
  let statuses$ = sources.network
  .map(status => {
      let services = { };
      for (let name in status) {
        let clusterStatus = status[name];
        extractResolveLog(clusterStatus, services, "Completed", "completed")
        extractResolveLog(clusterStatus, services, "InProgress", "inprogress")
        extractDepState(clusterStatus, services)
      }
      interpret(services)

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
      div(".reports",
        reportView(cluster)
      )
    ]);
}

function reportView(cluster) {
  if (cluster.interpretation.error != null) {
    return div(reportClass(cluster),[
        span(".state", "Error while " + cluster.interpretation.status + " " + cluster.interpretation.error.String),
        span(".intent", "Intended version: " + cluster.current.version +" instances: "+cluster.current.instances)
      ])
  }
  if (cluster.interpretation.status == "Deploying") {
    return [div(".report.deploy", [
          span(".state", "Deploying: from " + cluster.interpretation.versions.from +
              " to " + cluster.interpretation.versions.to)
          ])];
    }
    return [
      div(reportClass(cluster),[
          span(".state", cluster.interpretation.status + ": " + cluster.interpretation.version),
          span(".intent", "Instances: "+cluster.current.instances)
        ])
    ];
  }

  function reportClass(cluster) {
    let string = ".report." + cluster.interpretation.status.toLowerCase()
    if (cluster.interpretation.error != null) {
      string += ".error"
    }
    if (cluster.current.version == "0.0.0" && cluster.current.instances == 1) {
      string += ".unhelpful-settings" //0.0.0 + >0 intances hammers the docker repo
    }
    return string
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
