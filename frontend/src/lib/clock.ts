/** The current time in epoch ms. Server components read it through here, so the render stays a plain function of its inputs. */
export const currentTime = () => Date.now();
