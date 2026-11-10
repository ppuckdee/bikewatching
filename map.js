// DSC 209R Lab 7: Geospatial Visualizations.
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

const accessToken = "pk.eyJ1IjoicHB1Y2tkZWUiLCJhIjoiY213YjBudHJtMDBsMjMwb2l5aGRobzByYiJ9.baQ4s3XfflrFIAf0IpBpLQ";
const stationsUrl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
const tripsUrl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
const minutesPerDay = 1440;
const status = document.getElementById("map-status");

const bikeLanes = [
  {
    id: "boston-bike-lanes",
    url: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  },
  {
    id: "cambridge-bike-lanes",
    url: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  },
];

function minutesSinceMidnight(timestamp) {
  // The CSV records Boston clock time. Read the hour and minute as written.
  const [hour, minute] = (timestamp ?? "").slice(11, 16).split(":").map(Number);
  return hour * 60 + minute;
}

function countTrips(byMinute, selectedMinute) {
  if (selectedMinute === -1) {
    return d3.rollup(byMinute.flat(), (ids) => ids.length, (id) => id);
  }

  const first = (selectedMinute - 60 + minutesPerDay) % minutesPerDay;
  const last = (selectedMinute + 60) % minutesPerDay;
  const buckets = first <= last
    ? byMinute.slice(first, last + 1)
    : byMinute.slice(first).concat(byMinute.slice(0, last + 1));

  return d3.rollup(buckets.flat(), (ids) => ids.length, (id) => id);
}

function stationTraffic(stations, arrivals, departures) {
  return stations.map((station) => {
    const arrived = arrivals.get(station.short_name) ?? 0;
    const departed = departures.get(station.short_name) ?? 0;
    return {
      ...station,
      arrivals: arrived,
      departures: departed,
      totalTraffic: arrived + departed,
    };
  });
}

function renderStations(map, stations, trips) {
  // Group each trip endpoint by minute so moving the slider stays responsive.
  const arrivalsByMinute = Array.from({ length: minutesPerDay }, () => []);
  const departuresByMinute = Array.from({ length: minutesPerDay }, () => []);
  for (const trip of trips) {
    if (trip.start_station_id) {
      departuresByMinute[minutesSinceMidnight(trip.started_at)]?.push(trip.start_station_id);
    }
    if (trip.end_station_id) {
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)]?.push(trip.end_station_id);
    }
  }

  const allTraffic = stationTraffic(
    stations,
    countTrips(arrivalsByMinute, -1),
    countTrips(departuresByMinute, -1),
  );

  // Use a square-root scale to encode traffic with circle area.
  const radius = d3.scaleSqrt().domain([0, d3.max(allTraffic, (d) => d.totalTraffic) || 1]);
  const flow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
  const circles = d3.select("#map")
    .append("svg")
    .attr("class", "station-overlay")
    .attr("aria-label", "Bluebikes stations")
    .selectAll("circle")
    .data(allTraffic, (d) => d.short_name)
    .join("circle");
  circles.append("title");

  function updatePositions() {
    circles.each(function (station) {
      const point = map.project([+station.lon, +station.lat]);
      this.setAttribute("cx", point.x);
      this.setAttribute("cy", point.y);
    });
  }

  const slider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTime = document.getElementById("any-time");

  function updateTime() {
    const minute = Number(slider.value);
    const showAll = minute === -1;
    const time = new Date((minute % minutesPerDay) * 60000);
    const label = showAll
      ? "Any time"
      : time.toLocaleTimeString("en-US", { timeStyle: "short", timeZone: "UTC" });

    slider.setAttribute("aria-valuetext", label);
    selectedTime.hidden = showAll;
    anyTime.hidden = !showAll;
    if (!showAll) {
      selectedTime.textContent = label;
      selectedTime.dateTime = time.toISOString().slice(11, 16);
    }

    const traffic = showAll ? allTraffic : stationTraffic(
      stations,
      countTrips(arrivalsByMinute, minute),
      countTrips(departuresByMinute, minute),
    );

    radius.range(showAll ? [0, 25] : [3, 50]);
    circles.data(traffic, (d) => d.short_name)
      .attr("r", (d) => d.totalTraffic ? radius(d.totalTraffic) : 0)
      .style("--departure-ratio", (d) => flow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5))
      .select("title")
      .text((d) => `${d.name} · Trips ${d.totalTraffic} · Departures ${d.departures} · Arrivals ${d.arrivals}`);
  }

  updatePositions();
  map.on("move", updatePositions);
  map.on("resize", updatePositions);
  slider.addEventListener("input", updateTime);
  updateTime();
  slider.disabled = false;
}

function startMap() {
  mapboxgl.accessToken = accessToken;
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
  });

  let mapError = false;
  map.on("error", (event) => {
    mapError = true;
    status.textContent = "A map resource failed to load. Check the browser console.";
    console.error(event.error);
  });

  map.on("load", async () => {
    for (const { id, url } of bikeLanes) {
      map.addSource(id, { type: "geojson", data: url });
      map.addLayer({
        id,
        type: "line",
        source: id,
        paint: { "line-color": "green", "line-width": 3, "line-opacity": 0.4 },
      });
    }

    try {
      const [stationData, trips] = await Promise.all([d3.json(stationsUrl), d3.csv(tripsUrl)]);
      renderStations(map, stationData.data.stations, trips);
      if (!mapError) status.textContent = "";
    } catch (error) {
      status.textContent = "Bluebikes data could not load. Check the browser console.";
      console.error(error);
    }
  });
}

if (accessToken.startsWith("pk.")) {
  startMap();
} else {
  status.textContent = "Add your public Mapbox token in map.js to load the map.";
}
