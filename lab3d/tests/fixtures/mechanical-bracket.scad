// Synthetic mechanical fixture; authored for offline runtime validation.
// Dimensions are deliberate test geometry, not measurements of a character.
/* [Bracket] */
width = 40; // [30:2:60]
depth = 24; // [20:2:40]
height = 30; // [20:2:50]
thickness = 4; // [2:1:8]
hole_diameter = 6; // [3:1:10]
/* [Hidden] */
$fn = 48;

module bracket() {
  difference() {
    union() {
      translate([-width/2, -depth/2, 0]) cube([width, depth, thickness]);
      translate([-width/2, depth/2-thickness, 0]) cube([width, thickness, height]);
    }
    for (x = [-width/4, width/4]) {
      translate([x, -depth/5, -1]) cylinder(h=thickness+2, d=hole_diameter);
      translate([x, depth/2+1, height*0.68]) rotate([90,0,0]) cylinder(h=thickness+2, d=hole_diameter);
    }
  }
}
bracket();
