# MMM We Connect

Module for [MagicMirror](https://github.com/MichMich/MagicMirror/) showing data from your car using We Connect from Volkswagen.

This is currently under test, not ready for production.

## Screenshot

The car is connected and charging:

![Screenshot](doc/MMM-WeConnect-Screenshot-Charging.png)

The car is driving:

![Screenshot](doc/MMM-WeConnect-Screenshot-Driving.png)


## Installasjon

Go to `MagicMirror/modules` and write

    git clone https://github.com/ottopaulsen/MMM-WeConnect
    cd MMM-WeConnect
    npm install



## Configuration

Here is an example configuration with description. Put it in the `MagicMirror/config/config.js` file:
```
    {
        module: 'MMM-WeConnect',
        position: 'bottom_left',
        config: {
            email: '<we-connect.username>',
            password: '<we-connect-password>',
            refreshIntervalSeconds: 180,
            size: 300,
            showDistance: true,
            showPosition: true,
            showBatteryPercent: true,
            showRange: true,
            showConnectionStatus: true,
            showDriving: true,
            showBattery: true,
            positions: [
                {name: "Hjemme",
                    lat: 87.654321, 
                    lon: 12.345678,
                    marginMeters: 50
                },
                {name: "3T Moholt",
                    lat: 63.410412,
                    lon: 10.445588,
                    marginMeters: 50
                },
                {name: "Trondheim Spektrum",
                    lat: 63.426559,
                    lon: 10.376309,
                    marginMeters: 100
                },
            ],
            homePosition: "Hjemme"
        }
    },
```

Add entries for the positions you want to show with specific text (name). 

The homePosition should be set to the name of the position that represents home. This makes it possible to show how far away fro home the car is, when it is not at any known position.

If you want other languages, add your own translation file in the translations folder.

## Collaborate

Pull requests are welcome.

## TO DO

