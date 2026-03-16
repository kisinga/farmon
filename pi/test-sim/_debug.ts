import PocketBase from "pocketbase";
const pb = new PocketBase("http://127.0.0.1:8090");

async function fixSortOrderRequired() {
  // PocketBase admin API to update collection schemas - remove required from sort_order
  const collections = ["profile_fields", "profile_controls", "profile_visualizations"];

  for (const name of collections) {
    try {
      // Get the collection schema
      const res = await fetch(`http://127.0.0.1:8090/api/collections/${name}`, {
        headers: { "Content-Type": "application/json" },
      });
      const coll = await res.json();

      // Find and fix sort_order field
      const fields = coll.fields || [];
      let changed = false;
      for (const f of fields) {
        if (f.name === "sort_order" && f.required) {
          f.required = false;
          changed = true;
          console.log(`  Fixing ${name}.sort_order: required → false`);
        }
      }

      if (changed) {
        const updateRes = await fetch(`http://127.0.0.1:8090/api/collections/${name}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
        if (updateRes.ok) {
          console.log(`  ✓ ${name} updated`);
        } else {
          const err = await updateRes.json();
          console.log(`  ✗ ${name} update failed:`, err);
        }
      } else {
        console.log(`  ${name}: sort_order already not required`);
      }
    } catch (e: any) {
      console.log(`  Error on ${name}:`, e.message);
    }
  }

  // Test: create a field with sort_order=0
  console.log("\nTesting profile_fields create with sort_order=0...");
  try {
    const r = await pb.collection("profile_fields").create({
      profile: "od2a57bzrebs1oi",
      key: "test_field",
      display_name: "Test",
      unit: "V",
      sort_order: 0,
    });
    console.log("  ✓ Created:", r.id);
    await pb.collection("profile_fields").delete(r.id);
    console.log("  ✓ Cleaned up");
  } catch (e: any) {
    console.log("  ✗ Still failing:", JSON.stringify(e.response?.data || e.message));
  }
}

fixSortOrderRequired();
