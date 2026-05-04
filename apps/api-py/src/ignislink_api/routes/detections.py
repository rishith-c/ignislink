from fastapi import APIRouter, HTTPException, status

router = APIRouter()


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_detection_stub() -> dict[str, str]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="FIRMS detection ingestion begins in Stage 1 after filter/dedup tests land.",
    )
