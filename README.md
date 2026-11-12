# Kai Xiao — Research & Engineering

A read-only portfolio of numerical simulation, visual tracking, and systems engineering projects.

The page is organized into vertical project chapters with horizontal narrative steps. RC tracking progresses through a real failure, self-built simulation, historical algorithm comparisons, and field outcomes. Doctoral research connects inverse design, numerical modeling, and force/energy validation. Industrial work is presented as two distinct projects. Each step has its own evidence and concise explanation.

Desktop tabs, arrow buttons, keyboard navigation, native horizontal swipe, and direct links are supported. Without JavaScript, all steps remain readable vertically. Mobile layouts put the video or figure directly after the step heading. The page also links to published research, project source, and a two-page résumé. It contains no editing endpoints or private review notes.

## Local preview

Serve this directory with a static server that supports HTTP Range requests. Range support is required for the simulation scene-seek controls; a basic file server may render the page but fail seeking.

## Media attribution

The RC project presents its problem, self-built simulation, saved algorithm comparisons and field recordings in one section. The opening failure clip is a 9-second continuous excerpt from the old-app recording. Six simulation scenes play sequentially in one player; only one video on the page plays at a time. Videos pause when switching steps.

Field videos are continuous, normal-speed excerpts from the app's camera recordings, exported silently without stabilization, frame interpolation, AI enhancement or added tracking boxes. The old-app / Lynz example shows separate runs at the same site, not a synchronized controlled experiment. Old-app classification follows the user's contemporary filming records, not independently verified software metadata.

Historical offline comparisons replay YOLO11n + v22 and LoRAT results on real videos. Original watermarks from Bilibili creators RC小旋风 (Wuhan woods) and 小贝RC遥控车体验馆 (MIN-Z) are preserved; the underlying scenes are not presented as the author's own filming. The comparison retains errors and does not claim phone inference speed or a continuous identity success rate from sparse scores.

The large-deformation animation comes from the author's [research repository, pinned source](https://github.com/KaiXiao55/3DMorphingArchitectedMaterials/tree/d48e44e526d00809beee3b58ad3b167261f352dc/3.%20Bistability), `none.gif`. It is a cropped video conversion of the existing simulation frames. Playback time is not physical simulation time and colors do not represent stress. The force/energy figure is Fig. 3 from the [early research preprint](https://arxiv.org/abs/2310.14220); it compares designs and is not synchronized to the animation.

The inverse-design image is the complete, unmodified Fig. 1 from Xiao et al., [Nature Communications 13, 7474 (2022)](https://doi.org/10.1038/s41467-022-35224-2), © The Author(s) 2022, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It shows geometric reconstruction and corresponding fabricated prototypes; force and stability evidence is presented separately.
