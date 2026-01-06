import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

export default function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  actionLabel, 
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  iconColor = "text-gray-300"
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-2 border-dashed border-gray-200">
        <CardContent className="p-12 text-center">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
          >
            {Icon && <Icon className={`w-16 h-16 mx-auto mb-4 ${iconColor}`} />}
          </motion.div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">{description}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {actionLabel && onAction && (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button onClick={onAction} className="gap-2">
                  {actionLabel}
                </Button>
              </motion.div>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button onClick={onSecondaryAction} variant="outline" className="gap-2">
                  {secondaryActionLabel}
                </Button>
              </motion.div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}