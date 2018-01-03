/*
* Node Web Bluetooth
* Copyright (c) 2017 Rob Moran
*
* The MIT License (MIT)
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

import { EventDispatcher } from "./dispatcher";
import { BluetoothDevice } from "./device";
import { getServiceUUID } from "./helpers";
import { adapter, NobleAdapter } from "./adapter";

export interface BluetoothLEScanFilterInit {
    services?: Array<string>;
    name?: string;
    namePrefix?: string;
    // Maps unsigned shorts to BluetoothDataFilters.
    // object manufacturerData;
    // Maps BluetoothServiceUUIDs to BluetoothDataFilters.
    // object serviceData;
}

export interface RequestDeviceOptions {
    acceptAllDevices?: boolean;
    deviceFound?: (device: BluetoothDevice, selectFn: any) => boolean;
    filters?: Array<BluetoothLEScanFilterInit>;
    optionalServices?: Array<any>;
    scanTime?: any;
}

export class Bluetooth extends EventDispatcher {

    /**
     * Bluetooth Availability Changed event
     * @event
     */
    public static EVENT_AVAILABILITY: string = "availabilitychanged";

    private defaultScanTime = 10.24 * 1000;
    private scanner = null;

    constructor(public readonly referringDevice?: BluetoothDevice) {
        super();
        adapter.on(NobleAdapter.EVENT_ENABLED, value => {
            this.dispatchEvent(Bluetooth.EVENT_AVAILABILITY, value);
        });
    }

    private filterDevice(options: RequestDeviceOptions, deviceInfo, validServices) {
        let valid = false;

        options.filters.forEach(filter => {
            // Name
            if (filter.name && filter.name !== deviceInfo.name) return;

            // NamePrefix
            if (filter.namePrefix) {
                if (!deviceInfo.name || filter.namePrefix.length > deviceInfo.name.length) return;
                if (filter.namePrefix !== deviceInfo.name.substr(0, filter.namePrefix.length)) return;
            }

            // Services
            if (filter.services) {
                const serviceUUIDs = filter.services.map(getServiceUUID);
                const servicesValid = serviceUUIDs.every(serviceUUID => {
                    return (deviceInfo._serviceUUIDs.indexOf(serviceUUID) > -1);
                });

                if (!servicesValid) return;
                validServices = validServices.concat(serviceUUIDs);
            }

            valid = true;
        });

        if (!valid) return false;
        return deviceInfo;
    }

    public getAvailability(): Promise<boolean> {
        return new Promise((resolve, _reject) => {
            adapter.getEnabled(enabled => {
                resolve(enabled);
            });
        });
    }

    public requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice> {
        return new Promise((resolve, reject) => {
            if (this.scanner !== null) return reject("requestDevice error: request in progress");

            if (!options.acceptAllDevices && !options.deviceFound) {
                // Must have a filter
                if (!options.filters || options.filters.length === 0) {
                    return reject(new TypeError("requestDevice error: no filters specified"));
                }

                // Don't allow empty filters
                const emptyFilter = options.filters.some(filter => {
                    return (Object.keys(filter).length === 0);
                });
                if (emptyFilter) {
                    return reject(new TypeError("requestDevice error: empty filter specified"));
                }

                // Don't allow empty namePrefix
                const emptyPrefix = options.filters.some(filter => {
                    return (typeof filter.namePrefix !== "undefined" && filter.namePrefix === "");
                });
                if (emptyPrefix) {
                    return reject(new TypeError("requestDevice error: empty namePrefix specified"));
                }
            }

            let searchUUIDs = [];

            if (options.filters) {
                options.filters.forEach(filter => {
                    if (filter.services) searchUUIDs = searchUUIDs.concat(filter.services.map(getServiceUUID));
                });
            }

            // Unique-ify
            searchUUIDs = searchUUIDs.filter((item, index, array) => {
                return array.indexOf(item) === index;
            });

            let found = false;
            adapter.startScan(searchUUIDs, deviceInfo => {
                let validServices = [];

                function complete(bluetoothDevice) {
                    this.cancelRequest()
                    .then(() => {
                        resolve(bluetoothDevice);
                    });
                }

                // filter devices if filters specified
                if (options.filters) {
                    deviceInfo = this.filterDevice(options, deviceInfo, validServices);
                }

                if (deviceInfo) {
                    found = true;

                    // Add additional services
                    if (options.optionalServices) {
                        validServices = validServices.concat(options.optionalServices.map(getServiceUUID));
                    }

                    // Set unique list of allowed services
                    const allowedServices = validServices.filter((item, index, array) => {
                        return array.indexOf(item) === index;
                    });
                    Object.assign(deviceInfo, {
                        _bluetooth: this,
                        _allowedServices: allowedServices
                    });

                    const bluetoothDevice = new BluetoothDevice(deviceInfo);

                    function selectFn() {
                        complete.call(this, bluetoothDevice);
                    }

                    if (!options.deviceFound || options.deviceFound(bluetoothDevice, selectFn.bind(this)) === true) {
                        // If no deviceFound function, or deviceFound returns true, resolve with this device immediately
                        complete.call(this, bluetoothDevice);
                    }
                }
            }, () => {
                this.scanner = setTimeout(() => {
                    this.cancelRequest()
                    .then(() => {
                        if (!found) reject("requestDevice error: no devices found");
                    });
                }, options.scanTime || this.defaultScanTime);
            }, error => reject(`requestDevice error: ${error}`));
        });
    }

    public cancelRequest(): Promise<void> {
        return new Promise((resolve, _reject) => {
            if (this.scanner) {
                clearTimeout(this.scanner);
                this.scanner = null;
                adapter.stopScan();
            }
            resolve();
        });
    }
}
