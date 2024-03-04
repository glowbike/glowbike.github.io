import { Ble } from "./Ble.js";


// Leaders have:
// - Configuration Service
// - Control Service

// Followers have:
// - Configuration Service


// Services:
// - Configuration Service (0xFFE0)
//   - Serial Characteristic (0xFFE1)
//
// - Control Service (0x1111)
//   - Serial Characteristic (0xFFE1)





// I think actually implement, as functions, the entire range of
// the API.





/////////////////////////////////////////////////////////////////////
// GlowBikeConfigurationService
/////////////////////////////////////////////////////////////////////

class GlowBikeConfigurationService
{
    static SERVICE_UUID = "0x1111";
    
    constructor(ctc)
    {
        this.ctc_ = ctc;
        
        this.fnOnReceive_ = (str) => {}
        
        this.ctc_.SetOnNotifyCallback(arrayBuffer => {
            let str = new TextDecoder().decode(arrayBuffer);
            
            console.log(`OnNotify: "${str}"`);
            
            this.fnOnReceive_(str);
        });
        
        this.ctc_.Subscribe();
    }
    
    SetOnReceiveCallback(fn)
    {
        this.fnOnReceive_ = fn;
    }
    
    async Send(str)
    {
        await this.ctc_.WriteValueWithResponse(new TextEncoder().encode(str));
    }
}


/////////////////////////////////////////////////////////////////////
// GlowBikeControlService
/////////////////////////////////////////////////////////////////////

class GlowBikeControlService
{
    static SERVICE_UUID = "0xFFE0";
    
    constructor(ctc)
    {
        this.ctc_ = ctc;
    }
    
    async Send(str)
    {
        await this.ctc_.WriteValueWithNoResponse(new TextEncoder().encode(str));
    }
}


/////////////////////////////////////////////////////////////////////
// BleGlowBike
/////////////////////////////////////////////////////////////////////

export class BleGlowBike
{
    constructor()
    {
        this.ble_ = new Ble();

        this.wantToBeConnected_ = false;
        this.reconnecting_ = false;

        this.fnOnDisconnected_ = () => {};
        this.fnOnReconnected_ = () => {};

        this.ResetDiscoveredServicesState();
    }

    SetOnDisconnectedCallback(fn)
    {
        this.fnOnDisconnected_ = fn;
    }

    SetOnReconnectedCallback(fn)
    {
        this.fnOnReconnected_ = fn;
    }

    async Connect()
    {
        this.Disconnect();

        this.dev_ =
            await this.ble_.GetDevice(
                GlowBikeConfigurationService.SERVICE_UUID,
                GlowBikeControlService.SERVICE_UUID,
            );

        return await this.ConnectToDevice();
    }

    async ConnectToDevice()
    {
        let retVal = false;
        let tryAgain = this.dev_ != null;

        while (tryAgain)
        {
            let [retValAttempt, reason] = await this.ConnectAttempt();

            retVal = retValAttempt;

            console.log(`Connect Attempt - ${retValAttempt} / ${reason}`);

            if (retValAttempt != true)
            {
                if (reason == "FailedOrAborted")
                {
                    tryAgain = false;
                }
                else if (reason == "Failed")
                {
                    tryAgain = false;
                }
                else if (reason == "GotDisconnected")
                {
                    // try again
                }
                else if (reason == "NotGlowbike")
                {
                    this.connectWorkedButWasNotGlowBike = true;
                    tryAgain = false;
                }
                else
                {
                    console.log(`Unexpected failure reason - ${reason}`);
                    tryAgain = false;
                }
            }
            else
            {
                // no need to try again, you did it
                tryAgain = false;
            }
        }

        if (retVal)
        {
            this.wantToBeConnected_ = true;

            this.dev_.SetOnDisconnectedCallback(() => {
                this.OnDisconnected();
            });
        }

        return retVal;
    }

    async OnDisconnected()
    {
        // emit event
        this.fnOnDisconnected_();

        // connection lost to a device that we want to be connected to
        if (this.wantToBeConnected_)
        {
            this.reconnecting_ = true;
            console.log(`was connected, now disconnected, trying to re-connect (forever)`);

            // this will async loop forever
            // will need to allow caller to break this
            while (this.wantToBeConnected_ && await this.ConnectToDevice() == false)
            {
                console.log(`attempted re-connect failed, trying again`);
            }

            if (this.wantToBeConnected_)
            {
                console.log(`connected again`);

                // emit event
                this.fnOnReconnected_();
            }
            else
            {
                console.log(`re-connect canceled`);
                this.ResetDiscoveredServicesState();
            }

            this.reconnecting_ = false;
        }
    }

    async ConnectAttempt()
    {
        let retVal = false;
        let reason = "None";

        if (this.dev_)
        {
            if (await this.dev_.Connect())
            {
                // possible we get disconnected while async waiting to
                // scan services, let's detect that condition
                let gotDisconnected = false;
                this.dev_.SetOnDisconnectedCallback(() => {
                    gotDisconnected = true;
                });

                retVal = await this.FindServices();

                console.log(`find services retval: ${retVal}`);

                if (gotDisconnected)
                {
                    console.log("got disconnected while trying to scan services");
                    reason = "GotDisconnected";
                }
                else if (retVal == false)
                {
                    reason = "NotGlowBike";
                }
            }
            else
            {
                reason = "Failed";
            }
        }
        else
        {
            reason = "FailedOrAborted";
        }

        return [retVal, reason];
    }

    ConnectWorkedButWasNotGlowBike()
    {
        return this.connectWorkedButWasNotGlowBike;
    }

    async Disconnect()
    {
        this.wantToBeConnected_ = false;

        if (this.reconnecting_)
        {
            console.log(`Disconnect - breaking ongoing reconnect cycle`);
            // nothing special more to do here,
            // changing wantToBeConnected will break the async reconnect
        }
        else if (this.dev_)
        {
            console.log(`Disconnect - simply breaking existing connection`);
            await this.dev_.Disconnect();
            this.ResetDiscoveredServicesState();
        }
    }

    ResetDiscoveredServicesState()
    {
        this.controlService_ = null;
        this.configurationService_ = null;
        this.connectWorkedButWasNotGlowBike = false;
    }

    async FindServices()
    {
        this.ResetDiscoveredServicesState();

        console.log("scanning device for services");

        let svcList = await this.dev_.GetServiceList();
        for (let svc of svcList)
        {
            console.log(`svc: ${svc.GetUuid()}`);

            let ctcList = await svc.GetCharacteristicList();
            for (let ctc of ctcList)
            {
                const CTC_SERIAL_UUID = "0xFFE1";

                console.log(`ctc: ${ctc.GetUuid()}`);

                if (svc.GetUuid() == GlowBikeConfigurationService.SERVICE_UUID &&
                    ctc.GetUuid() == CTC_SERIAL_UUID)
                {
                    console.log(`Configuration Service match`);
                    this.configurationService_ = new GlowBikeConfigurationService(ctc);
                }
                else if (svc.GetUuid() == GlowBikeControlService.SERVICE_UUID &&
                         ctc.GetUuid() == CTC_SERIAL_UUID)
                {
                    console.log(`Control Service match`);
                    this.controlService_ = new GlowBikeControlService(ctc);
                }
            }
        }

        console.log(`done scanning`);

        return this.GetRole() != "None";
    }

    GetName()
    {
        return this.dev_ ? this.dev_.GetName() : "";
    }

    GetRole()
    {
        let retVal = "None";

        if (this.IsRoleLeader())
        {
            retVal = "Leader";
        }
        else if (this.IsRoleFollower())
        {
            retVal = "Follower";
        }

        return retVal;
    }

    IsRoleLeader()
    {
        return this.configurationService_ != null &&
               this.controlService_ != null;
    }

    IsRoleFollower()
    {
        return this.configurationService_ != null &&
               this.controlService_ == null;
    }

    GetConfigurationService()
    {
        return this.configurationService_;
    }

    GetControlService()
    {
        return this.controlService_;
    }
}
