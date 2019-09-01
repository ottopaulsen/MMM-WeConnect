
Module.register("MMM-WeConnect", {

    getScripts: function () {
        return [
            this.file('node_modules/jsonpointer/jsonpointer.js')
        ];
    },

    // Default module config
    defaults: {
        
    },


    start: function () {
        console.log(this.name + ' started.');
        this.carData = [];
        this.loaded = true;

        this.sendSocketNotification('WECONNECT_CONFIG', this.config);



        var self = this;
        setInterval(function () {
            self.updateDom(100);
        }, 5000);

    },

    socketNotificationReceived: function (notification, payload) {
        var self = this;
        console.log(self.name + ': Received socket notification ' + notification + ' with data ' + payload);
        if (notification === 'WECONNECT_CARDATA') {
            if (payload != null) {
                self.carData = JSON.parse(payload).reduce((m, [key, val])=> m.set(key, val) , new Map());
                console.log('Parsed carData: ', self.carData);
                self.updateDom();
            } else {
                console.log(self.name + ': WECONNECT_CARDATA - No payload');
            }
        }
    },

    getStyles: function () {
        return [
            'VW-Connect.css'
        ];
    },

    isValueTooOld: function (maxAgeSeconds, updatedTime) {
        // console.log(this.name + ': maxAgeSeconds = ', maxAgeSeconds);
        // console.log(this.name + ': updatedTime = ', updatedTime);
        // console.log(this.name + ': Date.now() = ', Date.now());
        if (maxAgeSeconds) {
            if ((updatedTime + maxAgeSeconds * 1000) < Date.now()) {
                return true;
            }
        }
        return false;
    },

    getDom: function () {
        // console.log(self.name + ': getDom');
        self = this;
        var wrapper = document.createElement("table");
        wrapper.className = "small";
        var first = true;



        
        if (self.carData.length === 0) {
            wrapper.innerHTML = (self.loaded) ? self.translate("NO CAR DATA") : self.translate("LOADING");
            wrapper.className = "small dimmed";
            console.log(self.name + ': No values');
            return wrapper;
        }

        console.log('Trying to display ', self.carData);
        self.carData.forEach(function (value, key) {
            var subWrapper = document.createElement("tr");

            // Label
            var labelWrapper = document.createElement("td");
            labelWrapper.innerHTML = value.label;
            labelWrapper.className = "align-left";
            subWrapper.appendChild(labelWrapper);

            // Value
            // tooOld = self.isValueTooOld(value.maxAgeSeconds, value.time);
            tooOld = false;
            var valueWrapper = document.createElement("td");
            valueWrapper.innerHTML = value.value;
            valueWrapper.className = "align-right medium " + (tooOld ? "dimmed" : "bright");
            subWrapper.appendChild(valueWrapper);

            // Suffix
            var suffixWrapper = document.createElement("td");
            suffixWrapper.innerHTML = value.suffix;
            suffixWrapper.className = "align-left";
            subWrapper.appendChild(suffixWrapper);

            wrapper.appendChild(subWrapper);
        });

        return wrapper;
    }
});