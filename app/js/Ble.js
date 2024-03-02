// https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
// https://developer.chrome.com/docs/capabilities/bluetooth

// This API is still in flux and varying degrees of support across browswers.
// Use only features which are supported and useful.


/////////////////////////////////////////////////////////////////////
// Utility
/////////////////////////////////////////////////////////////////////

export class ByteList
{
    constructor(arrayBuffer)
    {
        this.arrayBuffer_ = arrayBuffer;
        this.u8Buf_       = new Uint8Array(this.arrayBuffer_);
    }
    
    ToStringHex()
    {
        let retVal = "";

        let sep = "";

        retVal += "[";
        for (let b of this.u8Buf_)
        {
            let hex = b.toString(16).padStart(2, '0').toUpperCase();

            retVal += sep;
            retVal += "0x";
            retVal += hex;

            sep = ", ";
        }
        retVal += "]";

        return retVal;
    }
}




// Leaders have:
// - Control Service
// - Configuration Service

// Followers have:
// - Configuration Service


// Services:
// - Control Service (0x1111)
//   - Serial Characteristic (0xFFE1)
//
// - Configuration Service (0xFFE0)
//   - Serial Characteristic (0xFFE1)

/////////////////////////////////////////////////////////////////////
// Ble
/////////////////////////////////////////////////////////////////////

export class Ble
{
    static SERVICE_CONFIGURATION_UUID = 0x1111;
    static SERVICE_CONTROL_UUID       = 0xFFE0;
    static CTC_SERIAL_UUID            = 0xFFE1;

    constructor()
    {
        this.devList_ = new Map();
    }

    Debug()
    {
        console.log(`Debug`);
        for (let [id, dev] of this.devList_)
        {
            dev.Debug();
        }
    }

    async GetDevice()
    {
        let retVal = null;

        try
        {
            let dev = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [Ble.SERVICE_CONFIGURATION_UUID] },
                ],
            });

            if (this.devList_.has(dev.id) == false)
            {
                this.devList_.set(dev.id, new BleDevice(dev));
            }
            
            retVal = this.devList_.get(dev.id);
        }
        catch (e)
        {
            console.log(`GetDevice: ${e}`)
        }

        return retVal;
    }
}


/////////////////////////////////////////////////////////////////////
//
// BleDevice
//
// Handles lifecycle of making and re-establishing connections.
//
// At the moment, written simply.  Bad callers could call Connect
// repeatedly before getting a callback from the first connect.
// They could call connect/disconnect/connect without the first
// returning yet and get a disconnected, connected, connected
// response stream.  Just don't do that.
//
/////////////////////////////////////////////////////////////////////

class BleDevice
{
    constructor (dev)
    {
        this.dev_ = dev;
        this.gattServer_ = null;
        this.wasExpected_ = false;

        this.Debug();

        this.fnOnConnect_ = (server) => { this.Log(`default fnOnConnect`) };
        this.fnOnDisconnect_ = (wasExpected) => { this.Log(`default fnOnDisconnect`) };

        this.dev_.addEventListener('gattserverdisconnected', e => {
            this.OnDisconnected();
        });
    }

    Log(str)
    {
        let timeMs = parseInt(performance.now());

        console.log(`[${timeMs}]: ${this.dev_.name}: ${str}`);
    }

    GetID()
    {
        return this.dev_.id;
    }

    GetName()
    {
        return this.dev_.name;
    }

    Debug()
    {
        console.log(`Device instance`);
        console.log(`${this.dev_.id} = ${this.dev_.name}`);
        console.log(`GATT: ${this.dev_.gatt}`);
    }

    SetOnConnectedCallback(fn)
    {
        this.fnOnConnect_ = fn;
    }

    SetOnDisconnectedCallback(fn)
    {
        this.fnOnDisconnect_ = fn;
    }

    async Connect()
    {
        if (this.dev_.gatt.connected == false)
        {
            this.gattServer_ = null;

            try
            {
                this.gattServer_ = await this.dev_.gatt.connect();
            }
            catch (e)
            {
                this.Log(`BleDevice Connect ERR: ${e}`);
            }
        }
        else
        {
            this.Log(`already connected, simulating connect`);
        }

        this.OnConnected();
    }

    Disconnect()
    {
        let simulateDisconnect = false;

        if (this.dev_.gatt.connected)
        {
            try
            {
                // this triggers the gattserverdisconnected event before returning
                this.wasExpected_ = true;
                this.gattServer_.disconnect();
                this.wasExpected_ = false;
            }
            catch (e)
            {
                this.Log(`BleDevice Disconnect ERR: ${e}, connected?  ${this.dev_.gatt.connected}`)
                simulateDisconnect = true;
            }
        }
        else
        {
            this.Log(`already disconnected`);
            simulateDisconnect = true;
        }

        if (simulateDisconnect)
        {
            this.Log("simulating disconnect");
            this.wasExpected_ = true;
            this.OnDisconnected();
            this.wasExpected_ = false;
        }
    }

    OnConnected()
    {
        this.Log(`BleDevice Connected - ${this.gattServer_ == null ? "FAIL" : "OK"}`);

        this.fnOnConnect_(this.gattServer_);
    }

    OnDisconnected()
    {
        this.Log(`BleDevice Disconnected, ${this.wasExpected_ ? "was" : "was NOT"} expected`);

        this.fnOnDisconnect_(this.wasExpected_);
    }

    async GetServiceList()
    {
        let bleSvcList = [];

        if (this.dev_.gatt.connected)
        {
            try
            {
                let svcList = await this.gattServer_.getPrimaryServices();

                for (let i = 0; i < svcList.length; ++i)
                {
                    bleSvcList.push(new BleService(svcList[i]));
                }
            }
            catch (e)
            {
                this.Log(`GetServiceList ERR: ${e}`);
            }
        }

        return bleSvcList;
    }
}


/////////////////////////////////////////////////////////////////////
// BleService
/////////////////////////////////////////////////////////////////////

class BleService
{
    constructor(svc)
    {
        this.svc_ = svc;
    }

    GetUuid()
    {
        return this.svc_.uuid.toUpperCase();
    }

    async GetCharacteristicList()
    {
        let bleCtcList = [];

        try
        {
            let ctcList = await this.svc_.getCharacteristics();

            for (let ctc of ctcList)
            {
                bleCtcList.push(new BleCharacteristic(ctc));
            }
        }
        catch (e)
        {
            console.log(`BleService GetCharacteristics ERR: ${e}`);
        }

        return bleCtcList;
    }
}


/////////////////////////////////////////////////////////////////////
// BleCharacteristic
/////////////////////////////////////////////////////////////////////

class BleCharacteristic
{
    constructor(ctc)
    {
        this.ctc_ = ctc;

        this.subscribed_ = false;
        this.fnOnNotify_ = (arrayBuffer) => {};

        this.fnOnCtcValueChange_ = e => {
            this.fnOnNotify_(e.target.value.buffer);
        };
    }

    GetUuid()
    {
        return this.ctc_.uuid.toUpperCase();
    }

    GetProperties()
    {
        return new BleProperties(this.ctc_.properties);
    }

    async ReadValue()
    {
        let retVal = new ArrayBuffer();

        try
        {
            let dataView = await this.ctc_.readValue();

            retVal = dataView.buffer;
        }
        catch (e)
        {
            console.log(`BleCharacteristic ReadValue ERR: ${e}`);
        }

        return retVal;
    }

    async WriteValue(arrayBuffer)
    {
        try
        {
            await this.ctc_.writeValue(arrayBuffer);
        }
        catch (e)
        {
            console.log(`BleCharacteristic WriteValue ERR: ${e}`);
        }
    }

    async GetDescriptorList()
    {
        let bleDescList = [];

        try
        {
            let descList = await this.ctc_.getDescriptors();

            for (let desc of descList)
            {
                bleDescList.push(new BleDescriptor(desc));
            }
        }
        catch (e)
        {
            console.log(`BleService GetDescriptors ERR: ${e}`);
        }

        return bleDescList;
    }

    SetOnNotifyCallback(fn)
    {
        this.fnOnNotify_ = fn;
    }

    async Subscribe()
    {
        if (this.subscribed_ == false)
        {
            try
            {
                await this.ctc_.startNotifications();
                this.ctc_.addEventListener('characteristicvaluechanged', this.fnOnCtcValueChange_);

                this.subscribed_ = true;
            }
            catch (e)
            {
                console.log(`BleService Subscribe ERR: ${e}`);
            }
        }
        else
        {
            console.log(`BleService Subscribe called when already subscribed`);
        }
    }

    async Unsubscribe()
    {
        if (this.subscribed_ == true)
        {
            try
            {
                await this.ctc_.startNotifications();
                this.ctc_.removeEventListener('characteristicvaluechanged', this.fnOnCtcValueChange_);

                this.subscribed_ = false;
            }
            catch (e)
            {
                console.log(`BleService Unsubscribe ERR: ${e}`);
            }
        }
        else
        {
            console.log(`BleService Unsubscribe called when already unsubscribed`);
        }
    }
}


/////////////////////////////////////////////////////////////////////
// BleProperties
/////////////////////////////////////////////////////////////////////

class BleProperties
{
    constructor(prop)
    {
        this.prop_ = prop;
    }

    CanRead()            { return this.prop_.read;                 }
    IsNotify()           { return this.prop_.notify;               }
    CanWrite()           { return this.prop_.write;                }
    CanWriteNoResponse() { return this.prop_.writeWithoutResponse; }
}


/////////////////////////////////////////////////////////////////////
// BleDescriptor
/////////////////////////////////////////////////////////////////////

class BleDescriptor
{
    constructor(desc)
    {
        this.desc_ = desc;
    }

    GetUuid()
    {
        return this.desc_.uuid.toUpperCase();
    }

    async ReadValue()
    {
        let retVal = new ArrayBuffer();

        try
        {
            // Mozilla spec appears to be incorrect in its wording, but correct in its actual implementation
            //
            // https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTDescriptor/readValue
            // "returns a Promise that resolves to an ArrayBuffer"
            //
            // https://webbluetoothcg.github.io/web-bluetooth/#dom-bluetoothremotegattdescriptor-readvalue
            // "Let buffer be an ArrayBuffer holding the retrieved value, and assign new DataView(buffer) to this.value.
            // "Resolve promise with this.value"

            let dataView = await this.desc_.readValue();

            retVal = dataView.buffer;
        }
        catch (e)
        {
            console.log(`BleDescriptor ReadValue ERR: ${e}`);
        }

        return retVal;
    }

    async WriteValue(arrayBuffer)
    {
        try
        {
            await this.desc_.writeValue(arrayBuffer);
        }
        catch (e)
        {
            console.log(`BleDescriptor WriteValue ERR: ${e}`);
        }
    }
}


