# Web Maze Visualizer

Interactive maze generation and solving directly in the browser. The visualization ports the maze algorithms from the Python scripts to JavaScript so you can experiment without Python.

## Features

- Pick from Recursive Backtracker, Growing Tree (Right Wall), Hunt-and-Kill, Sidewinder (Bidirectional), or Wilson's algorithm for generation
- Configure independent width and height to explore rectangular mazes
- A* path finding that highlights explored cells and the final shortest path
- Adjustable draw mode (walls vs. visited vs. heatmap) and animation speed
- Responsive canvas that adapts to the available space

## Running locally

1. Serve the folder with any static file server (for example `npx serve .` or `python3 -m http.server`).
2. Open the reported URL and head to `WebMazeVisualizer`.
3. Choose your dimensions, click **Generate Maze**, then **Solve Maze** when ready.

All logic runs client-side—no build tools or dependencies required.
