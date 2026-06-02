#!/usr/bin/env python3
import unittest

def get_industry_description(ind: str) -> str:
    switch = {
        'Automotive': 'vehicle (car/SUV/truck)',
        '2-Wheeler': '2-wheeler (bike/motorcycle/scooty/e-moped)',
        'Apparel': 'clothing/apparel/jewelry/garment',
        'Footwear': 'footwear (shoes/sneakers/formal/athletic)',
        'Electronics': 'electronic device (laptop/smartphone)',
        'Furniture': 'furniture (table/chair/sofa/decor)'
    }
    return switch.get(ind, 'product')

def build_prompt(industry: str, model_name: str, colors: list[str], target_audience: str, target_market: str, target_purpose: str, additional_context: str) -> str:
    industry_desc = get_industry_description(industry)
    audience_desc = f"Targeting: {target_audience.lower()} in {target_market.lower()} market" if target_audience else ""
    purpose_desc = f"Purpose: {target_purpose.lower()}" if target_purpose else ""
    context_desc = f"Context: {additional_context.strip()}" if additional_context else ""

    parts = [
        f"Generate an identity-preserved catalog image of the {industry_desc} [{model_name or 'Product'}] in [COLOR] color."
    ]
    if audience_desc:
        parts.append(audience_desc)
    if purpose_desc:
        parts.append(purpose_desc)
    if context_desc:
        parts.append(context_desc)
        
    parts.append("CRITICAL: Keep the product shape, geometry, proportions, camera angle, and structural details completely identical to the source image. Change only the color/texture to [COLOR].")
    return "\n".join(parts)

class TestPromptGeneration(unittest.TestCase):
    def test_industry_descriptions(self):
        self.assertEqual(get_industry_description("Automotive"), "vehicle (car/SUV/truck)")
        self.assertEqual(get_industry_description("2-Wheeler"), "2-wheeler (bike/motorcycle/scooty/e-moped)")
        self.assertEqual(get_industry_description("Apparel"), "clothing/apparel/jewelry/garment")
        self.assertEqual(get_industry_description("Footwear"), "footwear (shoes/sneakers/formal/athletic)")
        self.assertEqual(get_industry_description("Electronics"), "electronic device (laptop/smartphone)")
        self.assertEqual(get_industry_description("Furniture"), "furniture (table/chair/sofa/decor)")
        self.assertEqual(get_industry_description("Unknown"), "product")

    def test_prompt_building(self):
        prompt = build_prompt(
            industry="Automotive",
            model_name="Tesla Model 3",
            colors=["red", "white"],
            target_audience="Young Adults",
            target_market="India",
            target_purpose="Social Media Banner",
            additional_context="Cinematic night setting"
        )
        self.assertIn("vehicle (car/SUV/truck)", prompt)
        self.assertIn("[Tesla Model 3]", prompt)
        self.assertIn("Targeting: young adults in india market", prompt)
        self.assertIn("Purpose: social media banner", prompt)
        self.assertIn("Context: Cinematic night setting", prompt)
        self.assertIn("CRITICAL: Keep the product shape", prompt)

if __name__ == "__main__":
    unittest.main()
