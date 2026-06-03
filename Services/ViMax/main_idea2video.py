import asyncio
from pipelines.idea2video_pipeline import Idea2VideoPipeline


# SET YOUR OWN IDEA, USER REQUIREMENT, AND STYLE HERE
idea = """
A small robot learning to walk for the first time in a futuristic lab.
"""

user_requirement = """
Keep it very short with maximum 2 scenes.
"""

style = "Cartoon"



async def main():
    pipeline = Idea2VideoPipeline.init_from_config(
        config_path="configs/idea2video.yaml")
    await pipeline(idea=idea, user_requirement=user_requirement, style=style)

if __name__ == "__main__":
    asyncio.run(main())
