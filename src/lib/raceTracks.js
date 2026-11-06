/**
 * The KITT race's tracks. Each is a serpentine that crosses the screen in rows of bends, one row after another, joined by
 * hairpins at the sides. `rows` is how many crossings, `perRow` the bends in each, `wobble` how far they swing (a share
 * of the screen's height) and `width` the track's width in car widths. Shared with the server, which only needs the ids.
 */
export const TRACKS = [
  { id: 'coast', name: 'Pacific Coast Highway', difficulty: 'Easy', tagline: 'Wide lanes and long, easy sweeps.', rows: 2, perRow: 4, wobble: 0.05, width: 2.6 },
  { id: 'mulholland', name: 'Mulholland Drive', difficulty: 'Medium', tagline: 'Tighter bends, a lane and a half wide.', rows: 3, perRow: 5, wobble: 0.05, width: 1.9 },
  { id: 'switchback', name: "Devil's Switchback", difficulty: 'Hard', tagline: 'Hairpins with barely room for the car.', rows: 4, perRow: 6, wobble: 0.04, width: 1.45 },
];
