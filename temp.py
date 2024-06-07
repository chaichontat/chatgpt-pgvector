# %%
import logging
from concurrent.futures import ProcessPoolExecutor
from functools import wraps
from itertools import chain
from pathlib import Path

import click
import numpy as np
import tifffile
from imagecodecs import jpegxl_encode
from tqdm import tqdm
from tqdm.contrib.logging import logging_redirect_tqdm

log = logging.getLogger(__name__)


def dax_reader(path: Path):
    def parse_inf(f: str):
        return dict(x.split(" = ") for x in f.split("\n") if x)

    inf = parse_inf(path.with_suffix(".inf").read_text())
    n_frames = int(inf["number of frames"])

    image_data = np.fromfile(
        path, dtype=np.uint16, count=2048 * 2048 * n_frames
    ).reshape(n_frames, 2048, 2048)
    image_data.byteswap(False)

    return image_data


def run(*, level: int = 98, remove: bool = False):
    @wraps(run)
    def inner(path: Path):
        click.echo(path)
        match path.suffix:
            case ".jp2":
                import glymur

                jp2 = glymur.Jp2k(path)
                img = np.moveaxis(jp2[:], 2, 0)  # type: ignore
            case ".tif" | ".tiff":
                img = tifffile.imread(path)
            case ".dax":
                img = dax_reader(path)
            case _:
                raise NotImplementedError(f"Unknown file type {path.suffix}")

        path.with_suffix(".jxl").write_bytes(jpegxl_encode(img, level=level))
        if remove:
            path.unlink()

    return inner


@click.command()
@click.argument("path", type=click.Path(exists=True, dir_okay=True, file_okay=False))
@click.option("--remove", "-r", is_flag=True)
@click.option("--quality", "-q", default=98)
def main(path: Path, remove: bool = False, quality: int = 98):
    file_types = [".tif", ".tiff", ".jp2", ".dax"]
    files = list(
        chain.from_iterable(
            [Path(path).glob(f"**/*{file_type}") for file_type in file_types]
        )
    )
    click.echo(f"Found {len(files)} files")
    f = run(remove=remove, level=quality)
    with ProcessPoolExecutor() as pool:
        pool.submit(click.echo, "Starting")
        with tqdm(total=len(files)) as progress, logging_redirect_tqdm():
            for file in files:
                current_file = file  # For closure
                future = pool.submit(f, current_file)
                future.add_done_callback(lambda _: progress.update())
                future.add_done_callback(lambda _: log.info(f"Finished {current_file}"))


if __name__ == "__main__":
    main()


# %%
# import matplotlib.pyplot as plt
# import seaborn as sns

# sns.set()
# fig, axs = plt.subplots(ncols=2, figsize=(10, 5), dpi=200)

# axs[0].imshow(img[22, 600:700, 1600:1700])
# axs[1].imshow(xl[22, 600:700, 1600:1700])
# axs[1].axis("off")
# axs[0].axis("off")
# # %%
