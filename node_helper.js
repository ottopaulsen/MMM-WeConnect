"use strict";

const NodeHelper        = require("node_helper");
const dns               = require("dns").promises;
const weconnect         = require("./weconnect");
const { SetupRequiredError } = weconnect;

/*
 * EU Data Act field → carData key mapping.
 *
 * The normalized dataset uses dotted field names like
 * "battery_state_report.soc". We flatten the parts we care about into the
 * flat carData Map that the front-end already understands.
 */
function mapDatasetToCarData(dataset, carData) {
    function get(obj, ...keys) {
        for (const k of keys) {
            const parts = k.split(".");
            let cur = obj;
            for (const p of parts) {
                if (cur == null) break;
                cur = cur[p];
            }
            if (cur !== undefined && cur !== null) return cur;
        }
        return null;
    }

    // Battery SoC (%) — not available for all models via EU Data Act portal
    const soc = get(dataset,
        "battery_state_report.soc",
        "battery_level",
        "soc_electric_vehicle",
        "state_of_charge");
    if (soc !== null) {
        carData.set("battery", { label: "Battery level", value: Math.round(soc), suffix: "%" });
    }

    // Cruising range (km) — not available for all models via EU Data Act portal
    const range = get(dataset,
        "cruising_range_combined",
        "battery_state_report.cruising_range",
        "cruising_range_electric",
        "cruising_range_primary_engine");
    if (range !== null) {
        carData.set("range", { label: "Range", value: Math.round(range), suffix: "km" });
    }

    // Charging state — use direct field first (actual field name from portal)
    const chargingState = get(dataset,
        "charging_state",
        "charging_state_report.current_charge_state",
        "energy_flow");
    if (chargingState !== null) {
        const s = String(chargingState).toUpperCase();
        const isCharging = (s.includes("CHARG") || s.includes("FLOW")) &&
                           !s.includes("NOT_") && !s.includes("OFF") &&
                           !s.includes("READY") && !s.includes("ERROR");
        carData.set("charging", { label: "Charging", value: isCharging ? "CHARGING" : "NOT_CHARGING", suffix: "" });
    }

    // Remaining charging time (minutes) → convert to hours + minutes
    const remainMin = get(dataset,
        "remaining_charging_time_target_soc",
        "battery_state_report.remaining_charging_time_complete",
        "remaining_charging_time",
        "charging_state_report.remaining_charging_time");
    // Only use if it's a positive number (portal sometimes returns "minSOC" or similar strings)
    if (remainMin !== null && typeof remainMin === "number" && remainMin > 0) {
        const h = Math.floor(remainMin / 60);
        const m = remainMin % 60;
        carData.set("chargingRemainingHour",   { label: "Remaining hours",   value: h, suffix: "h" });
        carData.set("chargingRemainingMinute",  { label: "Remaining minutes", value: m, suffix: "m" });
    }

    // Outside temperature — portal reports in tenths of Kelvin (e.g. 2861 = 286.1 K = 12.95°C)
    const temp = get(dataset, "outside_temperature");
    if (temp !== null && typeof temp === "number" && temp > 0) {
        const celsius = Math.round((temp / 10 - 273.15) * 10) / 10;
        if (celsius > -60 && celsius < 60) { // sanity check
            carData.set("outsideTemp", { label: "Outside temp", value: celsius, suffix: "°C" });
        }
    }

    // Plug / connection state
    const plugState = get(dataset,
        "plug_state",
        "charging_state_report.plug_connection_state",
        "plug_connection_state");
    if (plugState !== null) {
        const connected = String(plugState).toUpperCase().includes("CONNECT") &&
                          !String(plugState).toUpperCase().includes("DISCONNECT");
        carData.set("connectionState", { label: "Connection state", value: connected ? "CONNECTED" : "DISCONNECTED", suffix: "" });
    }

    // Mileage / odometer
    const mileage = get(dataset, "mileage.value", "mileage");
    if (mileage !== null) {
        carData.set("distanceCovered", { label: "Distance", value: Math.round(mileage), suffix: "km" });
    }

    // Driving: EU Data Act data is snapshotted every 15 min, not real-time.
    // Only set driving=NO when we actually have plug state data (car is parked).
    // Without plug state we leave driving unset, so no cable will be drawn.
    if (plugState !== null) {
        carData.set("driving", { label: "Driving", value: "NO", suffix: "" });
    }

    // Lock state — use individual door locked_state_* fields (2=locked, observed from data)
    // The top-level lock_state string field doesn't update reliably.
    const doorLockFields = [
        "locked_state_front_left_door", "locked_state_front_right_door",
        "locked_state_rear_right_door", "locked_state__rear_left_door",
    ];
    const doorLockValues = doorLockFields.map(f => dataset[f]).filter(v => v !== undefined && v !== null);
    if (doorLockValues.length > 0) {
        // 2 = locked (observed: changed 3→2 when user locked car)
        const lockedCount = doorLockValues.filter(v => v === 2).length;
        const locked = lockedCount >= Math.ceil(doorLockValues.length / 2);
        carData.set("lockState", { label: "Lock state", value: locked ? "LOCKED" : "UNLOCKED", suffix: "" });
    } else {
        // Fallback to string field
        const lockState = get(dataset, "lock_state");
        if (lockState !== null) {
            carData.set("lockState", { label: "Lock state", value: String(lockState).toLowerCase() === "locked" ? "LOCKED" : "UNLOCKED", suffix: "" });
        }
    }

    // Dataset timestamp
    if (dataset._createdOn) {
        carData.set("lastDatasetTime", { label: "Last data", value: dataset._createdOn, suffix: "" });
    }
}

module.exports = NodeHelper.create({
    start() {
        console.log(this.name + ": Starting node helper");
        this.api            = null;
        this.config         = null;
        this.vin            = null;
        this.carData        = new Map();
        this._setupLogged   = false; // suppress repeated setup messages
    },

    log(...args) {
        if (this.config && this.config.logging) {
            console.log(...args);
        }
    },

    startReadingData() {
        this.scheduleRead(0);
    },

    // Schedule next read: 15 min + 30 s after the last dataset timestamp,
    // so we poll shortly after the portal is expected to have a new snapshot.
    scheduleRead(delayMs) {
        setTimeout(() => this.readData(), delayMs);
    },

    nextReadDelay(createdOn) {
        const PORTAL_INTERVAL_MS = 15 * 60 * 1000;
        const BUFFER_MS          = 30 * 1000;
        const MIN_DELAY_MS       = 60 * 1000;   // never poll more often than 1 min
        const FALLBACK_MS        = 5 * 60 * 1000; // on error, retry in 5 min
        if (!createdOn) return FALLBACK_MS;
        const nextExpected = new Date(createdOn).getTime() + PORTAL_INTERVAL_MS + BUFFER_MS;
        const delay = nextExpected - Date.now();
        const clamped = Math.max(delay, MIN_DELAY_MS);
        const mins = Math.round(clamped / 60000);
        this.log(this.name + ": Next data check in ~" + mins + " min (portal updates at " + new Date(nextExpected).toLocaleTimeString() + ")");
        return clamped;
    },

    async initApi() {
        if (this.api) return;
        const { email, password } = this.config;
        if (!email || !password) throw new Error("No email/password configured – add email and password to your MMM-WeConnect config");
        // Pass this.log to weconnect so HTTP call verbosity follows the logging config
        const log = (...args) => this.log(...args);
        this.api = weconnect.login(email, password, log);
    },

    async resolveVin() {
        if (this.vin) return this.vin;
        if (this.config.vin) { this.vin = this.config.vin; return this.vin; }

        console.log(this.name + ": No VIN in config – discovering vehicles...");
        const vins = await this.api.listVehicles();
        if (!vins.length) throw new Error(
            "No vehicles found in the EU Data Act portal. " +
            "Please set up continuous data at https://eu-data-act.drivesomethinggreater.com/"
        );
        if (vins.length > 1) {
            console.log(this.name + ": Multiple VINs found: " + vins.join(", ") + ". Using first. Add 'vin' to config to pick one.");
        }
        this.vin = vins[0];
        console.log(this.name + ": Using VIN " + this.vin);
        return this.vin;
    },

    async readData() {
        const online = await dns.lookup("eu-data-act.drivesomethinggreater.com").then(() => true).catch(() => false);
        if (!online) {
            console.log(this.name + ": No internet available");
            this.carData.set("apiConnection", { label: "API Connection", value: "NO INTERNET", suffix: "" });
            this.sendSocketNotification("WECONNECT_CARDATA", JSON.stringify([...this.carData.entries()]));
            this.scheduleRead(60 * 1000); // retry in 1 min
            return;
        }
        let createdOn = null;
        try {
            await this.initApi();
            const vin     = await this.resolveVin();
            const dataset = await this.api.getLatestDataset(vin);
            createdOn = dataset._createdOn;

            this._setupLogged = false; // reset if data flows again
            // Log complete dataset only when logging is enabled (verbose – 50+ lines)
            const { _meta, _datasetName, _createdOn, ...dataFields } = dataset;
            this.log(this.name + ": Full dataset (" + _createdOn + "):\n" +
                JSON.stringify(dataFields, null, 2));
            mapDatasetToCarData(dataset, this.carData);
            this.carData.set("apiConnection", { label: "API Connection", value: "OK", suffix: "" });
            this.log(this.name + ": carData updated", Object.fromEntries(this.carData));
        } catch (err) {
            if (err instanceof SetupRequiredError) {
                if (!this._setupLogged) {
                    console.log(this.name + ": Setup required:\n" + err.message);
                    this._setupLogged = true;
                }
                this.carData.set("apiConnection", { label: "API Connection", value: "SETUP_REQUIRED", suffix: "" });
            } else {
                console.error(this.name + ": Error reading car data:", err.message || err);
                this.carData.set("apiConnection", { label: "API Connection", value: "ERROR", suffix: "" });
            }
        }
        this.sendSocketNotification("WECONNECT_CARDATA", JSON.stringify([...this.carData.entries()]));
        this.scheduleRead(this.nextReadDelay(createdOn));
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "WECONNECT_CONFIG") {
            this.config = payload;
            this.startReadingData();
        }
    },
});
