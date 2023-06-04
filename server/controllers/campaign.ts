import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as cache from "../utils/cache.js";
import * as campaignModel from "../models/campaign.js";
import { isProductExist } from "../models/product.js";
import * as productImageModel from "../models/productImage.js";
import * as productVariantModel from "../models/productVariant.js";

const CACHE_KEY = cache.getCampaignKey();

export async function getCampaigns(req: Request, res: Response) {
  try {
    const cachedCampaigns = await cache.get(CACHE_KEY);
    if (cachedCampaigns) {
      const campaigns = z
        .array(campaignModel.CampaignSchema)
        .parse(JSON.parse(cachedCampaigns));
      res.status(200).json({
        data: campaigns,
      });
      return;
    }
    const campaigns = await campaignModel.getCampaigns();
    await cache.set(CACHE_KEY, JSON.stringify(campaigns));
    res.status(200).json({
      data: campaigns,
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ errors: err.message });
      return;
    }
    res.status(500).json({ errors: "get campaigns failed" });
  }
}

export async function checkProductExist(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { productId } = req.body;
  if (await isProductExist(productId)) {
    next();
    return;
  }
  res.status(400).json({ errors: "product not existed" });
  return;
}

export async function createCampaign(req: Request, res: Response) {
  try {
    const { productId, story } = req.body;
    if (!req.file?.filename) throw new Error("no picture");
    const { filename } = req.file;
    const campaignId = await campaignModel.createCampaign(
      productId,
      story,
      `/uploads/${filename}`
    );
    await cache.del(CACHE_KEY);
    res.status(200).json({ data: campaignId });
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ errors: err.message });
      return;
    }
    res.status(500).json({ errors: "create campaigns failed" });
  }
}

function mapId<Item extends { id: number }>(item: Item) {
  return item.id;
}

function mapImages(imagesObj: {
  [productId: string]: { main_image: string; images: string[] };
}) {
  return <Product extends { id: number }>(product: Product) => ({
    ...product,
    main_image: `${imagesObj[product.id]?.main_image}` ?? "",
    images: imagesObj[product.id]?.images?.map?.((image) => `${image}`) ?? [],
  });
}

function mapVariants(variantsObj: {
  [productId: string]: {
    variants: {
      color_code: string;
      size: string;
      stock: number;
    }[];
    sizes: Set<string>;
    colorsMap: { [colorCode: string]: string };
  };
}) {
  return <Product extends { id: number }>(product: Product) => ({
    ...product,
    ...variantsObj[product.id],
    sizes: Array.from(variantsObj[product.id].sizes),
    colors: Object.entries(variantsObj[product.id].colorsMap).map(
      ([key, value]) => ({
        code: key,
        name: value,
      })
    ),
  });
}


export async function getCampaignsForIOS(req: Request, res: Response) {
  try {
    const productsData = await campaignModel.getCampaignsFroIOS();
    const productIds = productsData?.map?.(mapId);
    const [images, variants] = await Promise.all([
      productImageModel.getProductImages(productIds),
      productVariantModel.getProductVariants(productIds),
    ]);
    const imagesObj = productImageModel.groupImages(images);
    const variantsObj = productVariantModel.groupVariants(variants);
    const products = productsData
      .map(mapImages(imagesObj))
      .map(mapVariants(variantsObj));  

    res.status(200).json({
      data: {
        title :"熱門商品",
        products : products
      }
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ errors: err.message });
      return;
    }
    res.status(500).json({ errors: "get campaigns failed" });
  }
}