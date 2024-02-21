import axios from "axios";
import config from "./config";
import EnvModel from "../models/env.model";
import type { NextFunction, Request, Response } from "express";
import VendorModel from "../models/vendor.model";
import PincodeModel from "../models/pincode.model";
import SellerModel from "../models/seller.model";
import { ExtendedRequest } from "./middleware";

export const validateEmail = (email: string): boolean => {
  return /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)*[a-zA-Z]{2,}))$/.test(
    email
  );
};

export const validatePhone = (phone: number): boolean => {
  return phone > 999999999;
};

export const connectSmartShip = () => {
  const requestBody = {
    username: config.SMART_SHIP_USERNAME,
    password: config.SMART_SHIP_PASSWORD,
    client_id: config.SMART_SHIP_CLIENT_ID,
    client_secret: config.SMART_SHIP_CLIENT_SECRET,
    grant_type: config.SMART_SHIP_GRANT_TYPE,
  };

  axios
    .post("https://oauth.smartship.in/loginToken.php", requestBody)
    .then((r) => {
      console.log("SmartShip API response: " + JSON.stringify(r.data));
      const responseBody = r.data;
      const savedEnv = new EnvModel(responseBody);
      EnvModel.deleteMany({})
        .then(() => {
          savedEnv
            .save()
            .then((r) => {
              console.log("Environment varibale Document updated successfully");
            })
            .catch((err) => {
              console.log("Error: while adding environment variable to ENV Document");
              console.log(err);
            });
        })
        .catch((err) => {
          console.log("Failed to clean up environment variables Document");
          console.log(err);
        });
    })
    .catch((err) => {
      console.log("SmartShip API Error Response: ");
      console.error(err?.response?.data);
    });
};

export const addVendors = async (req: Request, res: Response, next: NextFunction) => {
  const vendor = new VendorModel(req.body);
  let savedVendor;
  try {
    savedVendor = await vendor.save();
  } catch (err) {
    return next(err);
  }
  return res.status(200).send({
    valid: true,
    vendor: savedVendor,
  });
};

export const getSellers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellers = await SellerModel.find({}, { password: 0, __v: 0 });
    res.status(200).send({
      valid: true,
      sellers: sellers,
    });
  } catch (err) {
    return next(err);
  }
};

export const isValidPayload = (body: any, field: string[]): boolean => {
  if (Object.keys(body).length === 0) return false;
  for (let i = 0; i < field.length; i++) {
    if (!Object.keys(body).includes(field[i])) {
      console.log(field[i] + " is not a valid");
      return false;
    }
  }
  return true;
};

export const ratecalculatorController = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const body = req.body;

  if (
    !isValidPayload(body, [
      "pickupPincode",
      "deliveryPincode",
      "weight",
      "weightUnit",
      "boxLength",
      "boxWidth",
      "boxHeight",
      "sizeUnit",
      "isFragileGoods",
    ])
  ) {
    return res.status(200).send({
      valid: false,
      message: "inalid payload",
    });
  }
  const {
    pickupPincode,
    deliveryPincode,
    weight,
    weightUnit,
    boxLength,
    boxWidth,
    boxHeight,
    sizeUnit,
    isFragileGoods,
  } = req.body;

  const seller = req.seller;
  console.log(seller);
  const margin = seller.margin;

  let volumetricWeight = null;
  if (sizeUnit === "cm") {
    volumetricWeight = (boxLength * boxWidth * boxHeight) / 5000;
  } else if (sizeUnit === "m") {
    volumetricWeight = (boxLength * boxWidth * boxHeight) / 5;
  } else return res.status(200).send({ valid: false, message: "unhandled size unit" });
  const orderWeight = volumetricWeight > Number(weight) ? volumetricWeight : Number(weight);

  const pickupDetails = await getPincodeDetails(Number(pickupPincode));
  const deliveryDetails = await getPincodeDetails(Number(deliveryPincode));
  if (!pickupDetails || !deliveryDetails) {
    return res.status(200).send({ valid: false, message: "invalid pickup or delivery pincode" });
  }

  const vendors = await VendorModel.find({});
  const data2send = vendors.reduce((acc: any[], cv) => {
    let increment_price = null;
    if (pickupDetails.District === deliveryDetails.District) {
      // same city
      console.log("same city");
      increment_price = cv.withinCity;
    } else if (pickupDetails.StateName === deliveryDetails.StateName) {
      console.log("same state");
      // same state
      increment_price = cv.withinZone;
    } else if (
      MetroCitys.find((city) => city === pickupDetails?.District) &&
      MetroCitys.find((city) => city === deliveryDetails?.District)
    ) {
      console.log("metro ");
      // metro citys
      increment_price = cv.withinMetro;
    } else if (
      NorthEastStates.find((state) => state === pickupDetails?.StateName) &&
      NorthEastStates.find((state) => state === deliveryDetails?.StateName)
    ) {
      console.log("northeast");
      // north east
      increment_price = cv.northEast;
    } else {
      // rest of india
      increment_price = cv.withinRoi;
    }
    if (!increment_price) {
      return [{ message: "invalid incrementPrice" }];
    }

    const parterPickupTime = cv.pickupTime;
    const partnerPickupHour = Number(parterPickupTime.split(":")[0]);
    const partnerPickupMinute = Number(parterPickupTime.split(":")[1]);
    const partnerPickupSecond = Number(parterPickupTime.split(":")[2]);
    const pickupTime = new Date(new Date().setHours(partnerPickupHour, partnerPickupMinute, partnerPickupSecond, 0));

    const currentTime = new Date();
    let expectedPickup: string;
    if (pickupTime < currentTime) {
      expectedPickup = "Tomorrow";
    } else {
      expectedPickup = "Today";
    }

    const minWeight = cv.weightSlab;
    // TODO apply cod
    //@ts-ignore
    const weightIncrementRatio = (orderWeight - minWeight) / cv.incrementWeight;
    let totalCharge = increment_price.basePrice + increment_price?.incrementPrice * weightIncrementRatio;
    totalCharge = totalCharge + (margin / 100) * totalCharge;
    const gst = 0.18 * totalCharge;
    totalCharge = totalCharge += gst;

    //@ts-ignore
    return acc.concat({
      name: cv.name,
      minWeight,
      charge: totalCharge,
      type: cv.type,
      expectedPickup,
    });
  }, []);

  return res.status(200).send({ valid: true, rates: data2send });
};
// condition timing should be in the format: "hour:minute:second"
export const getNextDateWithDesiredTiming = (timing: string): Date => {
  const currentDate = new Date();
  const hour = Number(timing.split(":")[0]);
  const minute = Number(timing.split(":")[1]);
  const second = Number(timing.split(":")[2]);
  currentDate.setHours(hour, minute, second, 0);
  currentDate.setDate(currentDate.getDate() + 1);
  return currentDate;
};

export const getPincodeDetails = async (Pincode: number) => {
  const picodeDetails = await PincodeModel.findOne({ Pincode }).lean();
  return picodeDetails;
};

export const MetroCitys = ["Delhi", "Mumbai", "Kolkata", "Hyderabad", "Chennai", "Bangalore", "Ahmedabad"];
export const NorthEastStates = ["Arunachal Pradesh", "Assam", "Manipur", "Meghalya", "Mizoram", "Nagaland", "Tripura"];
